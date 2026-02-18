const snmp = require("net-snmp");
require("dotenv").config();

const OIDS = [
  "1.3.6.1.4.1.3902.1012.3.13.3", // GPON Uncfg Table
  "1.3.6.1.4.1.3902.1082.500.1.2.4.1.3", // Rogue/Pending SN
];

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
    // Bersihkan string dari tanda kutip dan spasi
    hex = value.replace(/["\s]/g, "");
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
 * Cek apakah string adalah format SN ONU (Contoh: ZTEG12345678)
 * @param {string} sn
 * @returns {boolean}
 */
function isValidSn(sn) {
  return /^[A-Z]{3,4}[0-9A-Z]{8,12}$/.test(sn);
}

async function getUnconfigured(ip, port, community) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ip, community, { port: port });
    const results = [];
    const seenSn = new Set();
    let pendingRequests = OIDS.length;

    if (pendingRequests === 0) return resolve([]);

    OIDS.forEach((oid) => {
      session.subtree(
        oid,
        (varbinds) => {
          for (let i = 0; i < varbinds.length; i++) {
            if (snmp.isVarbindError(varbinds[i])) {
              console.error(snmp.varbindError(varbinds[i]));
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
                if (!seenSn.has(snValue)) {
                  const parts = fullOid.split(".");
                  const onuId = parts.slice(-2).join(".");

                  results.push({
                    no: results.length + 1,
                    value: snValue,
                    onu_id: onuId,
                    raw_value: rawValue.toString("hex"),
                  });
                  seenSn.add(snValue);
                }
              }
            }
          }
        },
        (error) => {
          pendingRequests--;
          if (error) {
            // Jika error tapi sudah ada hasil, abaikan errornya (misal timeout di salah satu OID)
            console.error(`Error walking ${oid}:`, error);
          }

          if (pendingRequests === 0) {
            session.close();
            if (results.length === 0) {
              resolve([
                {
                  no: 1,
                  value: "Modem tidak ditemukan",
                  onu_id: "Empty",
                  raw_value: null,
                },
              ]);
            } else {
              resolve(results);
            }
          }
        },
      );
    });
  });
}

module.exports = { getUnconfigured };
