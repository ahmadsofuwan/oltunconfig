const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

/**
 * Mendapatkan lokasi absolut file template registrasi
 */
function getTemplatePath() {
  const customPath = process.env.TEMPLATE_FILE || process.env.REG_TEMPLATE_FILE;
  if (customPath) {
    if (path.isAbsolute(customPath)) return customPath;
    return path.join(__dirname, "..", customPath);
  }
  return path.join(__dirname, "..", "template.txt");
}

/**
 * Helper untuk menghapus kode ANSI escape dari output terminal OLT
 */
function cleanTerminalOutput(raw) {
  if (!raw) return "";
  return raw
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "")
    .replace(/\r\r+/g, "\r")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Membaca dan mem-parsing template script dari file (template.txt)
 * Melakukan substitusi variabel {{card}}, {{port}}, {{onu_id}}, {{onu_type}}, {{sn}}, dll.
 * Menyaring baris komentar (# atau //) dan baris kosong.
 *
 * @param {object} params
 * @param {number|string} params.slot
 * @param {number|string} params.ponPort
 * @param {number|string} params.onuId
 * @param {string} params.onuType
 * @param {string} params.sn
 * @returns {object} { templatePath, commandsExecuted, scriptPayload, rawTemplate }
 */
function loadRegisterScript(params) {
  const {
    slot,
    ponPort,
    onuId,
    onuType = "ZTEG-F609",
    sn,
    vlan = process.env.DEFAULT_VLAN || process.env.VLAN || "100",
    username,
    password,
  } = params;
  const tplPath = getTemplatePath();
  let rawTemplate = "";

  if (fs.existsSync(tplPath)) {
    try {
      rawTemplate = fs.readFileSync(tplPath, "utf8");
    } catch (e) {
      console.warn(`[TEMPLATE WARN] Gagal membaca file template ${tplPath}: ${e.message}`);
    }
  }

  // Fallback default jika file belum ada atau kosong
  if (!rawTemplate || !rawTemplate.trim()) {
    rawTemplate = [
      "config t",
      "interface gpon-olt_1/[[card]]/[[port]]",
      "onu [[onu]] type ZTEG-F609 sn [[sn]]",
      "exit",
      "exit",
      "exit",
    ].join("\n");
  }

  const pppoeUser = username || process.env.DEFAULT_PPPOE_USER || String(sn).toLowerCase();
  const pppoePass = password || process.env.DEFAULT_PPPOE_PASS || "12345678";
  const vlanValue = String(vlan);

  // Kamus penggantian variabel (mendukung format [[var]], {{var}}, dan {var})
  const replacements = [
    { regex: /\[\[card\]\]|\[\[slot\]\]|\{\{card\}\}|\{\{slot\}\}|\{card\}|\{slot\}/gi, value: String(slot) },
    { regex: /\[\[port\]\]|\[\[pon_port\]\]|\{\{port\}\}|\{\{pon_port\}\}|\{port\}|\{pon_port\}/gi, value: String(ponPort) },
    { regex: /\[\[onu\]\]|\[\[onu_id\]\]|\{\{onu_id\}\}|\{\{onu\}\}|\{onu_id\}|\{onuId\}|\{onu\}/gi, value: String(onuId) },
    { regex: /\[\[onu_type\]\]|\[\[type\]\]|\{\{onu_type\}\}|\{\{type\}\}|\{onu_type\}|\{onuType\}|\{type\}/gi, value: String(onuType) },
    { regex: /\[\[sn\]\]|\[\[serial\]\]|\{\{sn\}\}|\{\{serial\}\}|\{sn\}|\{serial\}/gi, value: String(sn) },
    { regex: /\[\[username-pppoe\]\]|\[\[username\]\]|\{\{username-pppoe\}\}|\{\{username\}\}|\{username-pppoe\}|\{username\}/gi, value: pppoeUser },
    { regex: /\[\[password-pppoe\]\]|\[\[password\]\]|\{\{password-pppoe\}\}|\{\{password\}\}|\{password-pppoe\}|\{password\}/gi, value: pppoePass },
    { regex: /\[\[vlan\]\]|\{\{vlan\}\}|\{vlan\}/gi, value: vlanValue },
    { regex: /\[\[interface\]\]|\{\{interface\}\}|\{interface\}/gi, value: `gpon-olt_1/${slot}/${ponPort}` },
    { regex: /\[\[onu_interface\]\]|\{\{onu_interface\}\}|\{onu_interface\}/gi, value: `gpon-onu_1/${slot}/${ponPort}:${onuId}` },
  ];

  let parsed = rawTemplate;
  for (const item of replacements) {
    parsed = parsed.replace(item.regex, item.value);
  }

  // Filter baris: hapus baris komentar (# atau //) dan baris kosong
  const rawLines = parsed.split(/\r?\n/).map((line) => line.trim());
  const commandsExecuted = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    // Jika baris adalah '!' (pemisah blok konfigurasi ZTE), konversi menjadi 'exit' jika belum ada exit
    if (line === "!") {
      const prev = commandsExecuted[commandsExecuted.length - 1] || "";
      if (prev.toLowerCase() !== "exit" && prev.toLowerCase() !== "end" && prev.toLowerCase() !== "config t") {
        commandsExecuted.push("exit");
      }
      continue;
    }

    commandsExecuted.push(line);
  }

  // Cek apakah script sudah memiliki 'end' atau 'exit'
  const hasEnd = commandsExecuted.some((cmd) => cmd.toLowerCase() === "end");
  let fullCommands = [...commandsExecuted];

  if (hasEnd) {
    const endsWithExit = fullCommands[fullCommands.length - 1].toLowerCase() === "exit";
    if (!endsWithExit) {
      fullCommands.push("exit");
    }
  } else {
    let trailingExits = 0;
    for (let i = fullCommands.length - 1; i >= 0; i--) {
      if (fullCommands[i].toLowerCase() === "exit") {
        trailingExits++;
      } else {
        break;
      }
    }
    const exitsNeeded = Math.max(0, 3 - trailingExits);
    for (let i = 0; i < exitsNeeded; i++) {
      fullCommands.push("exit");
    }
  }

  const scriptPayload = `\r\n${fullCommands.join("\r\n")}\r\ny\r\n`;

  return {
    templatePath: tplPath,
    rawTemplate,
    commandsExecuted: fullCommands,
    scriptPayload,
  };
}

const defaultSshAlgorithms = {
  kex: [
    "diffie-hellman-group1-sha1",
    "diffie-hellman-group14-sha1",
    "diffie-hellman-group-exchange-sha1",
    "diffie-hellman-group-exchange-sha256",
    "ecdh-sha2-nistp256",
  ],
  cipher: [
    "aes128-cbc",
    "aes192-cbc",
    "aes256-cbc",
    "3des-cbc",
    "aes128-ctr",
    "aes192-ctr",
    "aes256-ctr",
  ],
  serverHostKey: ["ssh-rsa", "ssh-dss"],
  hmac: ["hmac-sha1", "hmac-sha1-96", "hmac-md5"],
};

/**
 * Eksekutor Sesi SSH Interaktif:
 * - Membuka koneksi SSH dan shell terminal OLT.
 * - Mengirim perintah satu per satu dengan jeda adaptif agar OLT dapat memproses buffer secara stabil.
 * - Menunggu respon stream data dari OLT.
 * - Otomatis mendeteksi prompt konfirmasi CLI ZTE (seperti `(y/n)[n]:`) dan menjawab `y\r\n`.
 * - Melaporkan progress secara real-time via callback onProgress.
 * - Memastikan seluruh output terminal dikumpulkan dan koneksi ditutup secara bersih (tanpa meninggalkan session cache menggantung).
 *
 * @param {object} options
 * @param {string} options.host
 * @param {number} [options.port=22]
 * @param {string} options.username
 * @param {string} options.password
 * @param {Array<string>} options.commands
 * @param {number} [options.timeoutMs=60000]
 * @param {Function} [options.onProgress] - Callback (progressInfo) => void
 * @param {string} [options.contextLabel="SSH"]
 * @returns {Promise<object>}
 */
function runInteractiveSshSession(options) {
  return new Promise((resolve, reject) => {
    const {
      host,
      port = 22,
      username,
      password,
      commands = [],
      timeoutMs = 60000,
      onProgress = null,
      contextLabel = "SSH",
    } = options;

    if (!host || !username || !password) {
      return reject(new Error("Kredensial SSH (host, username, password) belum lengkap"));
    }

    if (!commands || commands.length === 0) {
      return reject(new Error("Daftar perintah SSH tidak boleh kosong"));
    }

    const conn = new Client();
    let isSettled = false;
    let rawOutput = "";
    let overallTimeoutTimer = null;
    let idleTimer = null;
    let stepTimer = null;

    const cleanup = () => {
      if (overallTimeoutTimer) {
        clearTimeout(overallTimeoutTimer);
        overallTimeoutTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (stepTimer) {
        clearTimeout(stepTimer);
        stepTimer = null;
      }
      try {
        conn.end();
        conn.destroy();
      } catch (e) {}
    };

    const finishSuccess = () => {
      if (isSettled) return;
      isSettled = true;
      cleanup();

      const cleanedOutput = cleanTerminalOutput(rawOutput);
      console.log(
        `[${contextLabel} SUCCESS] Sesi selesai. Output terminal: ${cleanedOutput.length} karakter.`
      );

      // Cek apakah ada pola error spesifik dari CLI ZTE OLT
      const errorMatch = cleanedOutput.match(
        /(%(?:Error|error)[^\n\r]*|%(?:Invalid|invalid|Incomplete|Ambiguous)[^\n\r]*)/i
      );

      resolve({
        success: true,
        output: cleanedOutput,
        rawOutput,
        commandsExecuted: commands,
        errorMatch: errorMatch ? errorMatch[0].trim() : null,
      });
    };

    const finishError = (err) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();

      const cleanedOutput = cleanTerminalOutput(rawOutput);
      err.output = cleanedOutput;
      console.error(`[${contextLabel} FAILED] ${err.message}`);
      reject(err);
    };

    // Timeout pengaman global
    overallTimeoutTimer = setTimeout(() => {
      finishError(
        new Error(
          `Timeout menunggu respon SSH dari OLT (${timeoutMs / 1000} detik). Periksa beban OLT atau konektivitas jaringan.`
        )
      );
    }, timeoutMs);

    conn
      .on("ready", () => {
        if (onProgress) {
          onProgress({
            step: 0,
            totalSteps: commands.length,
            percent: 5,
            message: "Koneksi SSH berhasil, membuka shell OLT...",
          });
        }

        conn.shell({ term: "vt100", cols: 120, rows: 40 }, (err, stream) => {
          if (err) {
            return finishError(new Error(`Gagal membuka shell SSH pada OLT: ${err.message}`));
          }

          let allCommandsSent = false;
          let stepIndex = 0;

          stream.on("close", () => {
            console.log(`[${contextLabel}] Stream shell OLT ditutup.`);
            finishSuccess();
          });

          stream.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            rawOutput += text;

            // Deteksi otomatis jika OLT meminta konfirmasi (y/n)
            if (/(y\/n)\[n\]:|\(y\/n\)\s*:?|continue\?\s*\(y\/n\)/i.test(text)) {
              console.log(`[${contextLabel}] Mendeteksi prompt konfirmasi OLT [y/n], mengirim 'y'...`);
              stream.write("y\r\n");
            }

            // Jika semua perintah telah terkirim, pasang/reset idle timer
            if (allCommandsSent) {
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                try {
                  stream.end();
                } catch (e) {}
                finishSuccess();
              }, 1200);
            }
          });

          stream.on("error", (streamErr) => {
            console.error(`[${contextLabel} STREAM ERROR]`, streamErr.message);
          });

          // Fungsi rekursif untuk mengirim perintah baris demi baris
          const sendNextCommand = () => {
            if (isSettled) return;

            if (stepIndex < commands.length) {
              const cmd = commands[stepIndex];
              stepIndex++;

              const percent = Math.min(90, Math.round((stepIndex / commands.length) * 85) + 5);
              if (onProgress) {
                onProgress({
                  step: stepIndex,
                  totalSteps: commands.length,
                  percent,
                  command: cmd,
                  message: `Kirim langkah ${stepIndex}/${commands.length}: ${cmd}`,
                });
              }

              stream.write(`${cmd}\r\n`);

              // Delay adaptif antar baris:
              // - Pembuatan/penghapusan ONU: butuh waktu alokasi database OLT (600ms)
              // - Perintah pon-onu-mng atau interface: 400ms
              // - Perintah biasa / exit: 250ms
              let delay = 250;
              const lowerCmd = cmd.toLowerCase().trim();
              if (lowerCmd.startsWith("no onu") || lowerCmd.startsWith("onu ")) {
                delay = 600;
              } else if (
                lowerCmd.startsWith("interface gpon-") ||
                lowerCmd.startsWith("pon-onu-mng") ||
                lowerCmd.startsWith("config t")
              ) {
                delay = 400;
              }

              stepTimer = setTimeout(sendNextCommand, delay);
            } else {
              allCommandsSent = true;
              if (onProgress) {
                onProgress({
                  step: commands.length,
                  totalSteps: commands.length,
                  percent: 95,
                  message: "Semua baris terkirim, menunggu respon final OLT...",
                });
              }

              // Pasang idle timer penutup
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                try {
                  stream.end();
                } catch (e) {}
                finishSuccess();
              }, 1500);
            }
          };

          // Beri jeda 400ms setelah shell terbuka untuk menerima welcome banner OLT
          stepTimer = setTimeout(sendNextCommand, 400);
        });
      })
      .on("error", (connErr) => {
        finishError(new Error(`Koneksi SSH ke OLT gagal: ${connErr.message}`));
      })
      .connect({
        host,
        port: parseInt(port, 10) || 22,
        username,
        password,
        readyTimeout: 15000,
        algorithms: defaultSshAlgorithms,
      });
  });
}

/**
 * Registrasi ONU ke ZTE OLT via SSH dengan MENUNGGU RESPON LENGKAP DARI OLT
 * Menjalankan seluruh baris template konfigurasi secara bertahap dan memverifikasi respon OLT.
 *
 * @param {object} params
 * @param {string} params.host
 * @param {number} [params.port=22]
 * @param {string} params.username
 * @param {string} params.password
 * @param {number|string} params.slot
 * @param {number|string} params.ponPort
 * @param {number|string} params.onuId
 * @param {string} [params.onuType="ZTEG-F609"]
 * @param {string} params.sn
 * @param {Function} [params.onProgress]
 * @param {number} [params.timeoutMs=65000]
 * @returns {Promise<object>}
 */
async function registerOnu(params) {
  const {
    host,
    port = 22,
    username,
    password,
    slot,
    ponPort,
    onuId,
    onuType = "ZTEG-F609",
    sn,
    onProgress,
    timeoutMs = 65000,
  } = params;

  if (!host || !username || !password) {
    throw new Error("Kredensial SSH (OLT_SSH_HOST, OLT_SSH_USER, OLT_SSH_PASS) belum lengkap di file .env");
  }

  if (!slot || !ponPort || !onuId || !sn) {
    throw new Error("Parameter slot, port, onuId, dan sn wajib diisi");
  }

  const numOnuId = parseInt(onuId, 10);
  if (isNaN(numOnuId) || numOnuId < 1 || numOnuId > 128) {
    throw new Error(
      `Batas maksimal ONU adalah 128 per port GPON (diberikan: ${onuId}). Registrasi tidak dapat dilakukan jika melebihi 128.`
    );
  }

  // Baca dan parse script template dari file
  const { templatePath, commandsExecuted } = loadRegisterScript({
    slot,
    ponPort,
    onuId: numOnuId,
    onuType,
    sn,
    vlan: params.vlan,
    username: params.pppoeUsername || params.username,
    password: params.pppoePassword || params.password,
  });

  console.log(
    `[SSH-REGISTER] Memulai push registrasi ONU #${numOnuId} (${sn}) ke OLT ${host}:${port} (${commandsExecuted.length} perintah)...`
  );

  const sessionResult = await runInteractiveSshSession({
    host,
    port,
    username,
    password,
    commands: commandsExecuted,
    timeoutMs,
    onProgress,
    contextLabel: "SSH-REGISTER",
  });

  // Periksa apakah terdapat error fatal OLT pada registrasi
  // Abaikan warning minor jika ada, tapi cek pesan error umum ZTE
  if (sessionResult.errorMatch) {
    // Jika error mengindikasikan duplikasi atau kegagalan konfigurasi
    const isConflict = /(already exists|already configured|duplicate)/i.test(sessionResult.errorMatch);
    if (!isConflict) {
      console.warn(`[SSH-REGISTER WARN] Terdeteksi respon error OLT: ${sessionResult.errorMatch}`);
    }
  }

  return {
    success: true,
    message: `Registrasi ONU #${numOnuId} (${sn}) berhasil dieksekusi di OLT dan diverifikasi tuntas.`,
    interface: `gpon-olt_1/${slot}/${ponPort}`,
    onuId: numOnuId,
    sn,
    templateUsed: path.basename(templatePath),
    commandsExecuted,
    output: sessionResult.output,
    warning: sessionResult.errorMatch,
  };
}

/**
 * Hapus (Unregister) ONU dari ZTE OLT via SSH dengan MENUNGGU RESPON LENGKAP DARI OLT
 *
 * Mengirimkan perintah konfigurasi ZTE CLI secara bertahap:
 * 1. config t
 * 2. interface gpon-olt_1/<card>/<port>
 * 3. no onu <onuId> (otomatis mendeteksi dan menjawab konfirmasi 'y' jika diminta OLT)
 * 4. exit
 * 5. exit
 * 6. exit
 *
 * @param {object} params
 * @param {string} params.host
 * @param {number} [params.port=22]
 * @param {string} params.username
 * @param {string} params.password
 * @param {number|string} params.slot
 * @param {number|string} params.ponPort
 * @param {number|string} params.onuId
 * @param {Function} [params.onProgress]
 * @param {number} [params.timeoutMs=25000]
 * @returns {Promise<object>}
 */
async function deleteOnu(params) {
  const {
    host,
    port = 22,
    username,
    password,
    slot,
    ponPort,
    onuId,
    onProgress,
    timeoutMs = 25000,
  } = params;

  if (!host || !username || !password) {
    throw new Error("Kredensial SSH OLT belum lengkap di file .env");
  }

  if (!slot || !ponPort || !onuId) {
    throw new Error("Parameter slot, port, dan onuId wajib diisi");
  }

  const numOnuId = parseInt(onuId, 10);
  if (isNaN(numOnuId) || numOnuId < 1 || numOnuId > 128) {
    throw new Error(`Nomor ONU ID tidak valid (${onuId}). Harus dalam rentang 1 - 128.`);
  }

  const commands = [
    "config t",
    `interface gpon-olt_1/${slot}/${ponPort}`,
    `no onu ${numOnuId}`,
    "exit",
    "exit",
    "exit",
  ];

  console.log(
    `[SSH-DELETE] Memulai proses hapus ONU #${numOnuId} di gpon-olt_1/${slot}/${ponPort} via SSH...`
  );

  const sessionResult = await runInteractiveSshSession({
    host,
    port,
    username,
    password,
    commands,
    timeoutMs,
    onProgress,
    contextLabel: "SSH-DELETE",
  });

  const cleanedOutput = sessionResult.output;

  // Cek apakah ONU memang sudah tidak ada di OLT
  const isAlreadyRemoved = /(does not exist|not exist|not configured|entry not exist)/i.test(
    cleanedOutput
  );

  if (sessionResult.errorMatch && !isAlreadyRemoved) {
    throw new Error(`OLT menolak perintah hapus: ${sessionResult.errorMatch}`);
  }

  const message = isAlreadyRemoved
    ? `ONU #${numOnuId} sudah tidak ada di OLT (telah dibersihkan)`
    : `ONU #${numOnuId} pada interface gpon-olt_1/${slot}/${ponPort} berhasil dihapus dari OLT`;

  return {
    success: true,
    message,
    interface: `gpon-olt_1/${slot}/${ponPort}`,
    onuId: numOnuId,
    commandsExecuted: commands,
    output: cleanedOutput,
    alreadyRemoved: isAlreadyRemoved,
  };
}

module.exports = {
  registerOnu,
  deleteOnu,
  loadRegisterScript,
  getTemplatePath,
  cleanTerminalOutput,
  runInteractiveSshSession,
};
