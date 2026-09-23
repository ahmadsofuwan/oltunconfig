const snmp = require("net-snmp");

// OID utama untuk tabel Serial Number ONU Unconfigured pada ZTE C300/C320 (zxGponUnCfgSnOntSN)
const UNCONFIGURED_SN_OID = "1.3.6.1.4.1.3902.1012.3.13.3.1.2";

/**
 * Konversi Hex ke Serial Number (SN)
 * @param {Buffer|string} value
 * @returns {string}
 */
function hexToSn(value) {
  let hex = "";
  if (Buffer.isBuffer(value)) {
    hex = value.toString("hex");
  } else {
    hex = String(value).replace(/["\s]/g, "");
  }

  // Jika formatnya hex (minimal 16 karakter)
  if (hex.length >= 16 && /^[0-9a-fA-F]+$/.test(hex)) {
    try {
      const vendorHex = hex.substring(0, 8);
      const rest = hex.substring(8);
      const vendor = Buffer.from(vendorHex, "hex").toString("utf8");
      return (vendor + rest).toUpperCase();
    } catch (e) {
      return hex.toUpperCase();
    }
  }
  return hex;
}

/**
 * Cek apakah string adalah format SN ONU (Contoh: ZTEG12345678, HWTC12345678, dll)
 * @param {string} sn
 * @returns {boolean}
 */
function isValidSn(sn) {
  return /^[A-Z]{3,4}[0-9A-Z]{8,12}$/i.test(sn);
}

/**
 * Ekstraksi informasi Card (Slot), Port, dan ONU Index dari OID ZTE
 * Format ifIndex ZTE C300: 0x10 <slot:8bit> <port:8bit> 00
 * @param {string} fullOid
 * @returns {object}
 */
function parseOidLocation(fullOid) {
  const parts = fullOid.split(".").map(Number);
  const onuSeq = parts[parts.length - 1];
  const ifIndex = parts[parts.length - 2];

  // ZTE composite ifIndex decoding:
  // Byte 2 (bit 16..23): Slot / Card (Contoh: 3 untuk gpon-onu_1/3/1:1)
  // Byte 1 (bit 8..15):  Port PON (Contoh: 1 untuk port 1)
  const slot = (ifIndex >>> 16) & 0xff;
  const port = (ifIndex >>> 8) & 0xff;

  return {
    ifIndex,
    shelf: 1,
    slot,
    card: slot,
    port,
    onuSeq,
    name: `gpon-onu_1/${slot}/${port}:${onuSeq}`,
    displayText: `Card ${slot} / Port ${port}`,
  };
}

/**
 * Validasi apakah lokasi modem cocok dengan filter target Card dan Port
 * @param {object} location
 * @param {number|string|null} targetCard
 * @param {number|string|null} targetPort
 * @returns {boolean}
 */
function matchesTarget(location, targetCard, targetPort) {
  if (targetCard !== null && targetCard !== undefined && targetCard !== "") {
    const tc = parseInt(targetCard, 10);
    if (!isNaN(tc)) {
      if (location.card !== tc && location.slot !== tc) {
        return false;
      }
    }
  }

  if (targetPort !== null && targetPort !== undefined && targetPort !== "") {
    const tp = parseInt(targetPort, 10);
    if (!isNaN(tp)) {
      if (location.port !== tp) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Ambil daftar modem unconfigured via SNMP dengan opsi filter Card & Port
 * @param {string} ip
 * @param {number} port
 * @param {string} community
 * @param {object} options { card, port }
 * @returns {Promise<Array>}
 */
async function getUnconfigured(ip, port, community, options = {}) {
  const { card: targetCard = null, port: targetPort = null } = options;

  return new Promise((resolve) => {
    const session = snmp.createSession(ip, community, {
      port: port,
      timeout: 5000,
      retries: 2,
      version: snmp.Version2c,
    });

    const results = [];
    const seenSn = new Set();

    session.subtree(
      UNCONFIGURED_SN_OID,
      (varbinds) => {
        for (let i = 0; i < varbinds.length; i++) {
          if (snmp.isVarbindError(varbinds[i])) {
            console.error("SNMP Varbind Error:", snmp.varbindError(varbinds[i]));
          } else {
            const fullOid = varbinds[i].oid;
            const rawValue = varbinds[i].value;

            let snValue = "";
            if (Buffer.isBuffer(rawValue)) {
              snValue = hexToSn(rawValue);
            } else {
              snValue = rawValue.toString();
            }

            if (isValidSn(snValue)) {
              const loc = parseOidLocation(fullOid);

              // Filter berdasarkan target Card dan Port jika disetel
              if (matchesTarget(loc, targetCard, targetPort)) {
                if (!seenSn.has(snValue)) {
                  results.push({
                    no: results.length + 1,
                    value: snValue,
                    card: loc.card,
                    slot: loc.slot,
                    port: loc.port,
                    onu_seq: loc.onuSeq,
                    onu_id: loc.displayText,
                    interface: loc.name,
                    raw_value: Buffer.isBuffer(rawValue)
                      ? rawValue.toString("hex")
                      : rawValue,
                  });
                  seenSn.add(snValue);
                }
              }
            }
          }
        }
      },
      (error) => {
        try {
          session.close();
        } catch (closeErr) {
          // ignore
        }

        if (error) {
          console.error(`Error walking ${UNCONFIGURED_SN_OID}:`, error.message || error);
        }

        if (results.length === 0) {
          let emptyMsg = "Modem tidak ditemukan";
          if (targetCard && targetPort) {
            emptyMsg = `Modem tidak ditemukan pada Card ${targetCard} Port ${targetPort}`;
          } else if (targetCard) {
            emptyMsg = `Modem tidak ditemukan pada Card ${targetCard}`;
          } else if (targetPort) {
            emptyMsg = `Modem tidak ditemukan pada Port ${targetPort}`;
          }

          resolve([
            {
              no: 1,
              value: emptyMsg,
              onu_id: "Empty",
              empty: true,
              raw_value: null,
            },
          ]);
        } else {
          // Urutkan ulang nomor baris
          results.forEach((r, idx) => {
            r.no = idx + 1;
          });
          resolve(results);
        }
      }
    );
  });
}

/**
 * Pindai daftar ONU terdaftar pada port PON untuk menemukan ONU ID yang masih kosong
 * @param {string} ip
 * @param {number} port
 * @param {string} community
 * @param {number|string} slot
 * @param {number|string} ponPort
 * @returns {Promise<object>}
 */
async function getAvailableOnuId(ip, port, community, slot, ponPort) {
  return new Promise((resolve, reject) => {
    const s = parseInt(slot, 10);
    const p = parseInt(ponPort, 10);
    if (isNaN(s) || isNaN(p)) {
      return reject(new Error("Parameter card/slot dan port tidak valid"));
    }

    const ifIndex = 0x10000000 | (s << 16) | (p << 8);
    const targetOid = `1.3.6.1.4.1.3902.1012.3.28.1.1.5.${ifIndex}`;

    const session = snmp.createSession(ip, community, {
      port: port,
      timeout: 5000,
      retries: 2,
      version: snmp.Version2c,
    });

    const usedIds = new Set();

    session.subtree(
      targetOid,
      (varbinds) => {
        for (let i = 0; i < varbinds.length; i++) {
          if (!snmp.isVarbindError(varbinds[i])) {
            const parts = varbinds[i].oid.split(".").map(Number);
            const onuId = parts[parts.length - 1];
            if (!isNaN(onuId) && onuId > 0 && onuId <= 128) {
              usedIds.add(onuId);
            }
          }
        }
      },
      (error) => {
        try {
          session.close();
        } catch (e) {}

        if (error) {
          console.error(`Error walking ${targetOid}:`, error.message || error);
        }

        let nextAvailable = null;
        for (let id = 1; id <= 128; id++) {
          if (!usedIds.has(id)) {
            nextAvailable = id;
            break;
          }
        }

        const isFull = usedIds.size >= 128 || nextAvailable === null;

        resolve({
          slot: s,
          port: p,
          ifIndex,
          interface: `gpon-olt_1/${s}/${p}`,
          totalUsed: usedIds.size,
          usedIds: Array.from(usedIds).sort((a, b) => a - b),
          nextAvailableOnuId: nextAvailable,
          isFull: isFull,
          maxCapacity: 128,
          canRegister: !isFull && nextAvailable !== null && nextAvailable <= 128,
        });
      }
    );
  });
}

/**
 * Konversi nilai raw SNMP ke dBm untuk daya optik ZTE C300
 * Rumus dari ZTE-AN-OPTICAL-MODULE-MIB / OneclikPro:
 * signedRaw = (raw > 32768) ? (raw - 65536) : raw;
 * dBm = (signedRaw * 0.002) - 30.0
 *
 * @param {number|string} rawValue
 * @returns {object}
 */
function parseLaserDbm(rawValue) {
  const val = Number(rawValue);
  if (isNaN(val) || val >= 65535 || val <= 0) {
    return {
      raw: val,
      dbm: null,
      formatted: "Offline / LOS",
      quality: "danger",
      isOnline: false,
    };
  }

  const signedRaw = val > 32768 ? val - 65536 : val;
  const dbm = parseFloat(((signedRaw * 0.002) - 30.0).toFixed(2));

  let quality = "good";
  let qualityText = "Sangat Baik";
  if (dbm < -27) {
    quality = "critical";
    qualityText = "Redaman Kritis";
  } else if (dbm < -24) {
    quality = "warning";
    qualityText = "Redaman Sedang";
  } else if (dbm > -8) {
    quality = "warning";
    qualityText = "Sinyal Terlalu Kuat";
  }

  return {
    raw: val,
    dbm,
    formatted: `${dbm} dBm`,
    quality,
    qualityText,
    isOnline: true,
  };
}

/**
 * Cek status sinyal laser (Rx & Tx Power) serta IP ONU via SNMP
 *
 * Mengacu pada implementasi OneclikPro (App\Http\Controllers\Helpers\Snmp.php):
 * - Rx Power: 1.3.6.1.4.1.3902.1012.3.50.12.1.1.10.<ifIndex>.<onuId>.1
 * - Tx Power: 1.3.6.1.4.1.3902.1012.3.50.12.1.1.14.<ifIndex>.<onuId>.1
 * - Status:   1.3.6.1.4.1.3902.1012.3.28.2.1.4.<ifIndex>.<onuId>
 * - Host/Mgmt IP (OID_ONU_IP): 1.3.6.1.4.1.3902.1012.3.28.1.1.20.<ifIndex>.<onuId>
 * - WAN IP (OID_WAN_IP):       1.3.6.1.4.1.3902.1012.3.50.16.1.1.10.<ifIndex>.<onuId>.<wanId>
 *
 * @param {string} ip
 * @param {number} port
 * @param {string} community
 * @param {number|string} slot
 * @param {number|string} ponPort
 * @param {number|string} onuId
 * @returns {Promise<object>}
 */
function getOnuLaser(ip, port, community, slot, ponPort, onuId) {
  return new Promise((resolve, reject) => {
    const s = parseInt(slot, 10);
    const p = parseInt(ponPort, 10);
    const id = parseInt(onuId, 10);

    if (isNaN(s) || isNaN(p) || isNaN(id)) {
      return reject(new Error("Parameter slot, ponPort, dan onuId harus berupa angka"));
    }

    // ifIndex ZTE C300: 0x10 <slot> <port> 00 = 268435456 + (s << 16) + (p << 8)
    const ifIndex = 268435456 + (s << 16) + (p << 8);

    const rxOid = `1.3.6.1.4.1.3902.1012.3.50.12.1.1.10.${ifIndex}.${id}.1`;
    const txOid = `1.3.6.1.4.1.3902.1012.3.50.12.1.1.14.${ifIndex}.${id}.1`;
    const statusOid = `1.3.6.1.4.1.3902.1012.3.28.2.1.4.${ifIndex}.${id}`;
    const mgmtIpOid = `1.3.6.1.4.1.3902.1012.3.28.1.1.20.${ifIndex}.${id}`;

    // Target OIDs: Status, Rx, Tx, Host/Management IP, dan WAN IP (instance 1 s/d 5)
    const oids = [statusOid, rxOid, txOid, mgmtIpOid];
    for (let i = 1; i <= 5; i++) {
      oids.push(`1.3.6.1.4.1.3902.1012.3.50.16.1.1.10.${ifIndex}.${id}.${i}`);
    }

    const session = snmp.createSession(ip, community, {
      port: parseInt(port, 10) || 161,
      version: snmp.Version2c,
      timeout: 3000,
      retries: 1,
    });

    session.get(oids, (err, varbinds) => {
      try {
        session.close();
      } catch (e) {}

      let statusVal = null;
      let rxVal = null;
      let txVal = null;
      let mgmtIp = null;
      const wanIps = [];

      if (!err && varbinds) {
        varbinds.forEach((vb) => {
          if (!snmp.isVarbindError(vb) && vb.value !== null && vb.value !== undefined) {
            if (vb.oid === statusOid) {
              statusVal = Number(vb.value);
            } else if (vb.oid === rxOid) {
              rxVal = Number(vb.value);
            } else if (vb.oid === txOid) {
              txVal = Number(vb.value);
            } else if (vb.oid === mgmtIpOid) {
              const clean = String(vb.value).trim().replace(/^(IpAddress:\s*|["\s]+)/i, "").replace(/["\s]+$/, "");
              if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean) && clean !== "0.0.0.0") {
                mgmtIp = clean;
              }
            } else if (vb.oid.startsWith(`1.3.6.1.4.1.3902.1012.3.50.16.1.1.10.${ifIndex}.${id}.`)) {
              const clean = String(vb.value).trim().replace(/^(IpAddress:\s*|["\s]+)/i, "").replace(/["\s]+$/, "");
              if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean) && clean !== "0.0.0.0") {
                if (!wanIps.includes(clean)) {
                  wanIps.push(clean);
                }
              }
            }
          }
        });
      }

      // Tentukan IP utama: prioritaskan WAN IP (misal PPPoE/Internet), kemudian Management IP
      const primaryIp = wanIps[0] || mgmtIp || null;

      // Map status phase
      // 1: Lost, 2: LOS, 3: Online, 4: Dying Gasp, 6: Offline
      let statusText = "Tidak Terdeteksi";
      let statusColor = "secondary";
      if (statusVal === 3) {
        statusText = "Online";
        statusColor = "success";
      } else if (statusVal === 2) {
        statusText = "LOS (Loss of Signal)";
        statusColor = "danger";
      } else if (statusVal === 4) {
        statusText = "Dying Gasp (Power Off)";
        statusColor = "warning";
      } else if (statusVal === 1) {
        statusText = "Lost";
        statusColor = "danger";
      } else if (statusVal === 6) {
        statusText = "Offline";
        statusColor = "secondary";
      }

      const rxParsed = parseLaserDbm(rxVal);
      const txParsed = parseLaserDbm(txVal);

      resolve({
        success: true,
        slot: s,
        port: p,
        onuId: id,
        interface: `gpon-olt_1/${s}/${p}:${id}`,
        statusPhase: statusVal,
        statusText,
        statusColor,
        ip: primaryIp,
        ipDisplay: primaryIp || (statusVal === 3 ? "Belum Ada IP" : "Offline / Tidak Ada IP"),
        mgmtIp: mgmtIp || null,
        wanIps: wanIps,
        rx: rxParsed,
        tx: txParsed,
        timestamp: new Date().toISOString(),
      });
    });
  });
}

/**
 * Helper khusus untuk mengambil IP ONU (Management & WAN IP)
 * @param {string} ip
 * @param {number} port
 * @param {string} community
 * @param {number|string} slot
 * @param {number|string} ponPort
 * @param {number|string} onuId
 * @returns {Promise<object>}
 */
async function getOnuIp(ip, port, community, slot, ponPort, onuId) {
  const result = await getOnuLaser(ip, port, community, slot, ponPort, onuId);
  return {
    slot: result.slot,
    port: result.port,
    onuId: result.onuId,
    interface: result.interface,
    ip: result.ip,
    ipDisplay: result.ipDisplay,
    mgmtIp: result.mgmtIp,
    wanIps: result.wanIps,
  };
}

module.exports = {
  getUnconfigured,
  parseOidLocation,
  matchesTarget,
  getAvailableOnuId,
  getOnuLaser,
  getOnuIp,
  parseLaserDbm,
};

