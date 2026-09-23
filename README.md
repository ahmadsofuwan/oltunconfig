# GPON Unconfigured Modem Checker

Aplikasi berbasis Node.js untuk mendeteksi modem (ONU) yang belum dikonfigurasi pada OLT ZTE menggunakan protokol SNMP, serta melakukan registrasi otomatis ke OLT via koneksi SSH.

## 🚀 Fitur

- **Modern UI**: Antarmuka bersih dengan desain dark glassmorphism dan animasi responsif.
- **Kunci Target Card & Port (Filtering)**: Kemampuan mengunci deteksi hanya pada Card dan Port tertentu melalui `.env` atau tombol toggle di web UI.
- **Deteksi Otomatis ONU ID Kosong**: Memindai seluruh ONU ID yang terdaftar pada port PON target (1–128) dan otomatis merekomendasikan nomor ID terkecil yang masih kosong.
- **Push Registrasi ke OLT via SSH**: Mengeksekusi konfigurasi registrasi modem (`onu <id> type <type> sn <sn>`) langsung ke OLT ZTE melalui koneksi SSH (port 22).
- **Live Command Preview**: Pratinjau langsung rangkaian perintah ZTE CLI sebelum di-push ke perangkat.
- **Fast Scanning**: Menggunakan `net-snmp` untuk walk OID ZTE yang efisien dengan decoding bitwise index instan (~20ms).
- **Copy to Clipboard Modern**: Penyalinan Serial Number instan dengan feedback Toast non-blocking.
- **Environment Config**: Pengaturan IP, Community, Card, Port, dan Kredensial SSH via file `.env`.

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
4. Edit file `.env` dan masukkan IP OLT, SNMP Community, Card/Port target, serta kredensial SSH:
   ```env
   SNMP_IP=172.16.9.249
   SNMP_PORT=161
   SNMP_COMMUNITY=mediakiosro
   PORT=1122

   # Kunci deteksi pada Card dan Port tertentu (opsional):
   TARGET_CARD=3
   TARGET_PORT=1

   # Konfigurasi Koneksi SSH OLT untuk Push Registrasi:
   OLT_SSH_HOST=172.16.9.249
   OLT_SSH_PORT=22
   OLT_SSH_USER=ndy
   OLT_SSH_PASS=your_ssh_password_here
   DEFAULT_ONU_TYPE=ZTEG-F609
   ```

## 💻 Cara Penggunaan

1. Jalankan server:
   ```bash
   npm start
   # atau menggunakan PM2:
   npm run pm2
   ```
2. Buka browser dan akses:
   `http://localhost:1122` (atau port yang disetel di `.env`)
3. Klik tombol **"Scan Sekarang"** untuk mulai memindai modem yang belum terdaftar.
4. Pada baris modem yang terdeteksi, klik tombol **"⚡ Push"**:
   - Modal registrasi akan terbuka.
   - Sistem otomatis memindai dan mengisi **Nomor ONU ID kosong berikutnya** (misal ID 4).
   - Tipe ONU default terisi otomatis (misal `ZTEG-F609`, dapat diedit manual).
   - Klik **"🚀 Push ke OLT"** untuk mengeksekusi registrasi via SSH.

## 📡 REST API

- `GET /api/config`
  Mengembalikan informasi SNMP host, kredensial SSH (tanpa password), dan status filter aktif.
- `GET /api/unconfigured`
  Memindai modem menggunakan filter default dari `.env`.
- `GET /api/unconfigured?card=3&port=1`
  Memindai modem pada Card 3 Port 1 secara dinamis.
- `GET /api/unconfigured?card=all&port=all`
  Memindai seluruh Card dan Port tanpa filter.
- `GET /api/next-onu-id?card=3&port=1`
  Memindai dan mengembalikan nomor ONU ID pertama yang masih kosong pada port PON tersebut beserta daftar ID yang terpakai.
- `POST /api/register-onu`
  Payload: `{ card, port, onuId, onuType, sn }`
  Mengeksekusi perintah registrasi ONU ke ZTE OLT via SSH.

## 📁 Struktur Folder

- `src/snmp.js`: Engine SNMP walk untuk unconfigured ONU dan deteksi ID kosong.
- `src/ssh.js`: Klien SSH untuk eksekusi rangkaian perintah ZTE OLT CLI.
- `src/server.js`: Server Express dan endpoint REST API.
- `template.txt`: Template script CLI registrasi ZTE OLT yang dapat dikustomisasi.
- `public/`: Antarmuka pengguna (HTML5, Glassmorphism CSS, Vanilla JS).
- `.env`: Konfigurasi environment (kredensial, template & target port).

## 📄 Lisensi

MIT
