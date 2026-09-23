const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "onus.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("[DATABASE ERROR] Gagal membuka file database SQLite:", err.message);
  } else {
    console.log(`[DATABASE] Terhubung ke SQLite: ${dbPath}`);
  }
});

// Inisialisasi tabel SQLite
function initDb() {
  return new Promise((resolve, reject) => {
    const query = `
      CREATE TABLE IF NOT EXISTS registered_onus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card INTEGER NOT NULL,
        port INTEGER NOT NULL,
        onu_id INTEGER NOT NULL,
        sn TEXT NOT NULL,
        onu_type TEXT DEFAULT 'ZTEG-F609',
        interface TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sn ON registered_onus (sn);
      CREATE INDEX IF NOT EXISTS idx_port ON registered_onus (card, port, onu_id);
    `;

    db.exec(query, (err) => {
      if (err) {
        console.error("[DATABASE ERROR] Inisialisasi tabel gagal:", err.message);
        return reject(err);
      }
      resolve();
    });
  });
}

// Simpan atau perbarui data registrasi ONU
function saveRegisteredOnu(data) {
  return new Promise((resolve, reject) => {
    const { card, port, onuId, sn, onuType = "ZTEG-F609", interfaceName } = data;
    const iface = interfaceName || `gpon-olt_1/${card}/${port}`;

    // Cek apakah SN ini sudah pernah tercatat pada interface yang sama
    const checkQuery = `SELECT id FROM registered_onus WHERE sn = ? AND status = 'active' LIMIT 1`;
    db.get(checkQuery, [sn], (err, row) => {
      if (err) return reject(err);

      if (row) {
        // Update record yang sudah ada
        const updateQuery = `
          UPDATE registered_onus
          SET card = ?, port = ?, onu_id = ?, onu_type = ?, interface = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        db.run(updateQuery, [card, port, onuId, onuType, iface, row.id], function (uErr) {
          if (uErr) return reject(uErr);
          resolve({ id: row.id, ...data, interface: iface, updated: true });
        });
      } else {
        // Insert record baru
        const insertQuery = `
          INSERT INTO registered_onus (card, port, onu_id, sn, onu_type, interface, status)
          VALUES (?, ?, ?, ?, ?, ?, 'active')
        `;
        db.run(insertQuery, [card, port, onuId, sn, onuType, iface], function (iErr) {
          if (iErr) return reject(iErr);
          resolve({ id: this.lastID, ...data, interface: iface, created: true });
        });
      }
    });
  });
}

// Ambil seluruh daftar modem yang terdaftar
function getRegisteredOnus() {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT id, card, port, onu_id, sn, onu_type, interface, status, created_at
      FROM registered_onus
      WHERE status = 'active'
      ORDER BY id DESC
    `;
    db.all(query, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Ambil detail satu modem berdasarkan ID
function getRegisteredOnuById(id) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM registered_onus WHERE id = ? LIMIT 1`;
    db.get(query, [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Hapus modem dari database (soft delete atau remove)
function deleteRegisteredOnu(id) {
  return new Promise((resolve, reject) => {
    const query = `DELETE FROM registered_onus WHERE id = ?`;
    db.run(query, [id], function (err) {
      if (err) return reject(err);
      resolve({ success: true, changes: this.changes });
    });
  });
}

module.exports = {
  db,
  initDb,
  saveRegisteredOnu,
  getRegisteredOnus,
  getRegisteredOnuById,
  deleteRegisteredOnu,
};
