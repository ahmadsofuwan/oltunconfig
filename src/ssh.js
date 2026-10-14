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
    commandsExecuted,
    scriptPayload,
  };
}

/**
 * Registrasi ONU ke ZTE OLT via SSH (Mode Eksekusi Langsung / Non-blocking)
 * Membaca script template dari file template.txt (atau konfigurasi TEMPLATE_FILE di .env)
 * sehingga teknisi dapat menyesuaikan perintah konfigurasi dengan bebas.
 *
 * Setelah script dieksekusi, session SSH langsung di-logout secara resmi (exit)
 * dan koneksi TCP ditutup tuntas (conn.destroy()) agar tidak meninggalkan cache/session
 * menggantung pada ZTE OLT.
 *
 * @param {object} params
 * @param {string} params.host
 * @param {number} params.port
 * @param {string} params.username
 * @param {string} params.password
 * @param {number|string} params.slot
 * @param {number|string} params.ponPort
 * @param {number|string} params.onuId
 * @param {string} params.onuType
 * @param {string} params.sn
 * @param {boolean} [params.waitForResponse=false] - Jika true, tunggu hingga seluruh output terminal diterima
 * @returns {Promise<object>}
 */
function registerOnu(params) {
  return new Promise((resolve, reject) => {
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
      waitForResponse = false,
    } = params;

    if (!host || !username || !password) {
      return reject(
        new Error(
          "Kredensial SSH (OLT_SSH_HOST, OLT_SSH_USER, OLT_SSH_PASS) belum lengkap di file .env"
        )
      );
    }

    if (!slot || !ponPort || !onuId || !sn) {
      return reject(new Error("Parameter slot, port, onuId, dan sn wajib diisi"));
    }

    const numOnuId = parseInt(onuId, 10);
    if (isNaN(numOnuId) || numOnuId < 1 || numOnuId > 128) {
      return reject(
        new Error(
          `Batas maksimal ONU adalah 128 per port GPON (diberikan: ${onuId}). Registrasi pada card dan port yang sama tidak dapat dilakukan jika melebihi 128.`
        )
      );
    }

    // Baca dan parse script template dari file
    const { templatePath, commandsExecuted, scriptPayload } = loadRegisterScript({
      slot,
      ponPort,
      onuId: numOnuId,
      onuType,
      sn,
      vlan: params.vlan,
      username: params.pppoeUsername || params.username,
      password: params.pppoePassword || params.password,
    });

    const sshAlgorithms = {
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

    // Segera kembalikan respons sukses ke UI (non-blocking)
    resolve({
      success: true,
      message: `Perintah registrasi ONU #${onuId} (${sn}) berhasil dikirim ke OLT (Mode Push Cepat Jeda 1 Detik)`,
      interface: `gpon-olt_1/${slot}/${ponPort}`,
      onuId,
      sn,
      templateUsed: path.basename(templatePath),
      commandsExecuted,
      output: [
        `# Menjalankan script registrasi ke ZTE OLT (Template: ${path.basename(templatePath)}):`,
        ...commandsExecuted,
        ``,
        `Status: Script langsung di-push ke OLT dengan jeda 1 detik & session SSH resmi ditutup tuntas (tidak ada session cache menggantung).`,
      ].join("\n"),
    });

    // Jalankan eksekusi SSH di background: langsung push script ke OLT tanpa menunggu respons terminal
    console.log(
      `[SSH-PUSH] Mengirim registrasi ONU #${onuId} (${sn}) ke OLT ${host}:${port} (Interface: gpon-olt_1/${slot}/${ponPort})...`
    );
    console.log(`[SSH-PUSH] Menggunakan file template: ${templatePath}`);
    console.log(`[SSH-PUSH] Daftar perintah yang dikirim:\n  > ${commandsExecuted.join("\n  > ")}`);

    const conn = new Client();
    let hasEnded = false;

    const safeEnd = () => {
      if (!hasEnded) {
        hasEnded = true;
        try {
          conn.end();
          conn.destroy();
        } catch (e) {}
      }
    };

    conn
      .on("ready", () => {
        conn.shell({ term: "vt100", cols: 120, rows: 40 }, (err, stream) => {
          if (err) {
            console.error("[SSH-PUSH ERROR] Gagal membuka shell:", err.message);
            safeEnd();
            return;
          }

          stream.on("close", () => {
            safeEnd();
          });

          // Tulis seluruh script registrasi langsung ke shell OLT tanpa menunggu respons
          stream.write(scriptPayload);

          // Jeda 1 detik (1000ms) sesuai instruksi pengguna lalu tutup sesi tuntas
          setTimeout(() => {
            try {
              stream.end();
            } catch (e) {}
            safeEnd();
            console.log(
              `[SSH-PUSH] Registrasi ONU #${onuId} (${sn}) BERHASIL di-push ke OLT (jeda 1s) & session SSH resmi ditutup.`
            );
          }, 1000);
        });
      })
      .on("error", (err) => {
        console.error(`[SSH-PUSH ERROR] Koneksi SSH ke OLT gagal: ${err.message}`);
        safeEnd();
      })
      .connect({
        host,
        port: parseInt(port, 10) || 22,
        username,
        password,
        readyTimeout: 30000,
        algorithms: sshAlgorithms,
      });
  });
}

/**
 * Hapus (Unregister) ONU dari ZTE OLT via SSH
 * Format perintah ZTE OLT CLI:
 * config t
 * interface gpon-olt_1/<card>/<port>
 * no onu <onuId>
 * exit
 * exit
 * exit
 * y
 *
 * @param {object} params
 * @param {string} params.host
 * @param {number} params.port
 * @param {string} params.username
 * @param {string} params.password
 * @param {number|string} params.slot
 * @param {number|string} params.ponPort
 * @param {number|string} params.onuId
 * @returns {Promise<object>}
 */
/**
 * Helper untuk menghapus kode ANSI escape dari output terminal
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
 * Hapus (Unregister) ONU dari ZTE OLT via SSH dengan MENUNGGU RESPON LENGKAP DARI OLT
 *
 * Mengirimkan perintah konfigurasi ZTE CLI secara bertahap:
 * 1. config t
 * 2. interface gpon-olt_1/<card>/<port>
 * 3. no onu <onuId>
 *    (Otomatis mendeteksi dan menjawab konfirmasi 'y' jika OLT meminta konfirmasi [y/n])
 * 4. exit
 * 5. exit
 * 6. exit
 *
 * Menunggu respon output terminal OLT sampai sesi selesai, memeriksa pesan error CLI ZTE,
 * dan hanya mengembalikan status berhasil jika perintah benar-benar diterima OLT.
 *
 * @param {object} params
 * @param {string} params.host
 * @param {number} [params.port=22]
 * @param {string} params.username
 * @param {string} params.password
 * @param {number|string} params.slot
 * @param {number|string} params.ponPort
 * @param {number|string} params.onuId
 * @param {number} [params.timeoutMs=20000]
 * @returns {Promise<object>}
 */
function deleteOnu(params) {
  return new Promise((resolve, reject) => {
    const {
      host,
      port = 22,
      username,
      password,
      slot,
      ponPort,
      onuId,
      timeoutMs = 20000,
    } = params;

    if (!host || !username || !password) {
      return reject(new Error("Kredensial SSH OLT belum lengkap di file .env"));
    }

    if (!slot || !ponPort || !onuId) {
      return reject(new Error("Parameter slot, port, dan onuId wajib diisi"));
    }

    const numOnuId = parseInt(onuId, 10);
    if (isNaN(numOnuId) || numOnuId < 1 || numOnuId > 128) {
      return reject(
        new Error(
          `Nomor ONU ID tidak valid (${onuId}). Harus dalam rentang 1 - 128.`
        )
      );
    }

    const commandsExecuted = [
      "config t",
      `interface gpon-olt_1/${slot}/${ponPort}`,
      `no onu ${numOnuId}`,
      "exit",
      "exit",
      "exit",
    ];

    const sshAlgorithms = {
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

    console.log(
      `[SSH-DELETE] Memulai koneksi SSH ke ${host}:${port} untuk menghapus ONU #${numOnuId} di gpon-olt_1/${slot}/${ponPort}...`
    );

    const conn = new Client();
    let isSettled = false;
    let rawOutput = "";
    let overallTimeoutTimer = null;
    let idleTimer = null;

    const cleanup = () => {
      if (overallTimeoutTimer) {
        clearTimeout(overallTimeoutTimer);
        overallTimeoutTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
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
        `[SSH-DELETE SUCCESS] Sesi SSH selesai. Output terminal diterima (${cleanedOutput.length} karakter).`
      );

      // Cek apakah ada error ZTE CLI spesifik
      // Pola error ZTE OLT: %Error, % Invalid, % Incomplete, % Ambiguous
      const errorMatch = cleanedOutput.match(
        /(%(?:Error|error)[^\n\r]*|%(?:Invalid|invalid|Incomplete|Ambiguous)[^\n\r]*)/i
      );

      // Cek jika errornya adalah bahwa ONU memang sudah tidak ada di OLT
      const isAlreadyRemoved = /(does not exist|not exist|not configured|entry not exist)/i.test(
        cleanedOutput
      );

      if (errorMatch && !isAlreadyRemoved) {
        const errorDetail = errorMatch[0].trim();
        console.warn(`[SSH-DELETE WARN] OLT mengembalikan error: ${errorDetail}`);
        return reject(
          new Error(`OLT menolak perintah hapus: ${errorDetail}`)
        );
      }

      const message = isAlreadyRemoved
        ? `ONU #${numOnuId} sudah tidak ada di OLT (telah dibersihkan)`
        : `ONU #${numOnuId} pada interface gpon-olt_1/${slot}/${ponPort} berhasil dihapus dari OLT`;

      resolve({
        success: true,
        message,
        interface: `gpon-olt_1/${slot}/${ponPort}`,
        onuId: numOnuId,
        commandsExecuted,
        output: cleanedOutput,
        alreadyRemoved: isAlreadyRemoved,
      });
    };

    const finishError = (err) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      console.error(`[SSH-DELETE FAILED] ${err.message}`);
      reject(err);
    };

    // Timeout pengaman utama (default 20s)
    overallTimeoutTimer = setTimeout(() => {
      finishError(
        new Error(
          `Timeout menunggu respon SSH dari OLT (${timeoutMs / 1000} detik). Periksa konektivitas jaringan atau beban OLT.`
        )
      );
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.shell({ term: "vt100", cols: 120, rows: 40 }, (err, stream) => {
          if (err) {
            return finishError(
              new Error(`Gagal membuka shell SSH pada OLT: ${err.message}`)
            );
          }

          let allCommandsSent = false;
          let answeredConfirmation = false;

          stream.on("close", () => {
            console.log("[SSH-DELETE] Stream shell OLT ditutup.");
            finishSuccess();
          });

          stream.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            rawOutput += text;

            // Deteksi otomatis jika OLT meminta konfirmasi (y/n)
            if (
              !answeredConfirmation &&
              /(y\/n)\[n\]:|\(y\/n\)\s*:?|continue\?\s*\(y\/n\)/i.test(text)
            ) {
              answeredConfirmation = true;
              console.log("[SSH-DELETE] Mendeteksi prompt konfirmasi OLT [y/n], mengirim 'y'...");
              stream.write("y\r\n");
            }

            // Jika semua perintah sudah dikirim, tunggu jeda hening (idle) 1.2 detik
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
            console.error("[SSH-DELETE STREAM ERROR]", streamErr.message);
          });

          // Kirim perintah secara berurutan dengan jeda aman antar baris
          const stepList = [
            "config t",
            `interface gpon-olt_1/${slot}/${ponPort}`,
            `no onu ${numOnuId}`,
            "exit",
            "exit",
            "exit",
          ];

          let stepIndex = 0;
          const sendNextStep = () => {
            if (isSettled) return;

            if (stepIndex < stepList.length) {
              const cmd = stepList[stepIndex++];
              stream.write(`${cmd}\r\n`);

              // Beri jeda 350ms antar perintah agar OLT memproses buffer dengan stabil
              // Khusus setelah 'no onu', beri jeda sedikit lebih lama (550ms) untuk antisipasi konfirmasi
              const delay = cmd.startsWith("no onu") ? 550 : 350;
              setTimeout(sendNextStep, delay);
            } else {
              allCommandsSent = true;

              // Pasang idle timer jika OLT tidak menutup stream secara otomatis
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                try {
                  stream.end();
                } catch (e) {}
                finishSuccess();
              }, 1500);
            }
          };

          // Mulai eksekusi perintah setelah jeda 300ms dari pembukaan shell
          setTimeout(sendNextStep, 300);
        });
      })
      .on("error", (connErr) => {
        finishError(
          new Error(`Koneksi SSH ke OLT gagal: ${connErr.message}`)
        );
      })
      .connect({
        host,
        port: parseInt(port, 10) || 22,
        username,
        password,
        readyTimeout: 15000,
        algorithms: sshAlgorithms,
      });
  });
}

module.exports = { registerOnu, deleteOnu, loadRegisterScript, getTemplatePath, cleanTerminalOutput };


