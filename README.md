# GPON Unconfigured Modem Checker

Aplikasi berbasis Node.js untuk mendeteksi modem (ONU) yang belum dikonfigurasi pada OLT ZTE menggunakan protokol SNMP. Proyek ini merupakan konversi dari script PHP ke arsitektur Node.js yang modern.

## 🚀 Fitur

- **Modern UI**: Antarmuka bersih dengan desain glassmorphism.
- **Fast Scanning**: Menggunakan `net-snmp` untuk walk OID yang efisien.
- **Copy to Clipboard**: Memudahkan penyalinan Serial Number untuk konfigurasi manual.
- **Environment Config**: Pengaturan IP dan Community via file `.env`.

## 🛠️ Instalasi

1. Clone repositori ini atau download source codenya.
2. Jalankan instalasi dependensi:
   ```bash
   npm install
   ```
3. Salin file `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
4. Edit file `.env` dan masukkan IP OLT serta SNMP Community Anda:
   ```env
   SNMP_IP=10.0.0.1
   SNMP_PORT=161
   SNMP_COMMUNITY=public
   PORT=3000
   ```

## 💻 Cara Penggunaan

1. Jalankan server:
   ```bash
   node src/server.js
   ```
2. Buka browser dan akses:
   `http://localhost:3000`
3. Klik tombol **"Scan Sekarang"** untuk mulai memindai modem yang belum terdaftar.

## 📁 Struktur Folder

- `src/`: Berisi logika backend (Express server & SNMP logic).
- `public/`: Berisi file frontend (HTML, CSS, JS).
- `.env`: Konfigurasi environment (tidak boleh di-upload ke Git).

## 📄 Lisensi

MIT
