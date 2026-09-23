const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getUnconfigured, getAvailableOnuId, getOnuLaser } = require('./snmp');
const { registerOnu, deleteOnu, loadRegisterScript, getTemplatePath } = require('./ssh');
const { initDb, saveRegisteredOnu, getRegisteredOnus, getRegisteredOnuById, deleteRegisteredOnu } = require('./db');

const app = express();
// Gunakan APP_PORT / HTTP_PORT atau PORT (jika PORT > 100, untuk mencegah konflik jika ada user yang menyetel PORT=2 untuk pon port)
const port = process.env.APP_PORT || process.env.HTTP_PORT || (process.env.PORT > 100 ? process.env.PORT : 3000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Helper untuk membaca filter Card & Port (dari query param atau .env)
 */
function getTargetFilter(query = {}) {
    const cardParam = query.card !== undefined && query.card !== ''
        ? query.card
        : (process.env.TARGET_CARD || process.env.PON_CARD || process.env.CARD || null);

    const ponPortParam = query.port !== undefined && query.port !== ''
        ? query.port
        : (process.env.TARGET_PORT || process.env.PON_PORT || process.env.GPON_PORT || (process.env.PORT && process.env.PORT <= 100 ? process.env.PORT : null));

    const card = cardParam ? String(cardParam).trim() : null;
    const ponPort = ponPortParam ? String(ponPortParam).trim() : null;

    let displayText = "Semua Card & Port";
    if (card && card !== 'all' && ponPort && ponPort !== 'all') {
        displayText = `Card ${card} • Port ${ponPort}`;
    } else if (card && card !== 'all') {
        displayText = `Card ${card} • Semua Port`;
    } else if (ponPort && ponPort !== 'all') {
        displayText = `Port ${ponPort} (Semua Card)`;
    }

    return {
        card: card,
        port: ponPort,
        active: Boolean((card && card !== 'all') || (ponPort && ponPort !== 'all')),
        displayText: displayText
    };
}

// Endpoint untuk cek konfigurasi & status filter
app.get('/api/config', (req, res) => {
    const filter = getTargetFilter(req.query);
    const tplPath = getTemplatePath();
    res.json({
        snmp_ip: process.env.SNMP_IP,
        ssh: {
            host: process.env.OLT_SSH_HOST || process.env.SNMP_IP,
            port: parseInt(process.env.OLT_SSH_PORT, 10) || 22,
            username: process.env.OLT_SSH_USER || 'ndy',
            hasPassword: Boolean(process.env.OLT_SSH_PASS),
            defaultOnuType: process.env.DEFAULT_ONU_TYPE || 'ZTEG-F609',
            templateFile: path.basename(tplPath),
            templateExists: fs.existsSync(tplPath)
        },
        filter: filter
    });
});

// Endpoint untuk membaca template registrasi
app.get('/api/template', (req, res) => {
    try {
        const tplPath = getTemplatePath();
        const exists = fs.existsSync(tplPath);
        const content = exists ? fs.readFileSync(tplPath, 'utf8') : '';
        res.json({
            path: tplPath,
            filename: path.basename(tplPath),
            exists,
            content,
            supportedVariables: [
                '[[card]] / [[slot]]',
                '[[port]] / [[pon_port]]',
                '[[onu]] / [[onu_id]]',
                '[[sn]] / [[serial]]',
                '[[onu_type]] / [[type]]',
                '[[VLAN]] / [[vlan]]',
                '[[username-pppoe]] / [[username]]',
                '[[password-pppoe]] / [[password]]',
                '[[interface]]',
                '[[onu_interface]]'
            ]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint data unconfigured ONU
app.get('/api/unconfigured', async (req, res) => {
    try {
        const ip = process.env.SNMP_IP;
        const snmpPort = parseInt(process.env.SNMP_PORT) || 161;
        const community = process.env.SNMP_COMMUNITY;

        const filter = getTargetFilter(req.query);
        const cardTarget = filter.card === 'all' ? null : filter.card;
        const portTarget = filter.port === 'all' ? null : filter.port;

        const data = await getUnconfigured(ip, snmpPort, community, {
            card: cardTarget,
            port: portTarget
        });

        res.json({
            filter: filter,
            data: data
        });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Gagal mengambil data SNMP', details: error.message });
    }
});

// Endpoint untuk memindai ONU ID yang kosong/tersedia pada port PON tertentu
app.get('/api/next-onu-id', async (req, res) => {
    try {
        const card = req.query.card || req.query.slot;
        const ponPort = req.query.port;

        if (!card || !ponPort) {
            return res.status(400).json({ error: 'Parameter card dan port wajib disertakan' });
        }

        const ip = process.env.SNMP_IP;
        const snmpPort = parseInt(process.env.SNMP_PORT, 10) || 161;
        const community = process.env.SNMP_COMMUNITY;

        const result = await getAvailableOnuId(ip, snmpPort, community, card, ponPort);
        res.json(result);
    } catch (error) {
        console.error('Get Available ONU ID Error:', error);
        res.status(500).json({ error: 'Gagal mendeteksi ONU ID kosong', details: error.message });
    }
});

// Endpoint untuk registrasi ONU ke OLT via SSH (Semua logika otomatis di backend)
app.post('/api/register-onu', async (req, res) => {
    try {
        const { card, port: ponPort, onuId, onuType, sn } = req.body;

        if (!card || !ponPort || !sn) {
            return res.status(400).json({ error: 'Parameter card, port, dan sn wajib diisi' });
        }

        const snmpHost = process.env.SNMP_IP || '127.0.0.1';
        const snmpPort = parseInt(process.env.SNMP_PORT, 10) || 161;
        const snmpComm = process.env.SNMP_COMMUNITY || 'public';

        // Penentuan & validasi nomor ONU ID (Batas maksimal 128 ONU per port GPON)
        let targetOnuId = null;
        const hasManualId = (onuId !== undefined && onuId !== null && String(onuId).trim() !== '');

        if (hasManualId) {
            targetOnuId = parseInt(onuId, 10);
            if (isNaN(targetOnuId) || targetOnuId < 1 || targetOnuId > 128) {
                return res.status(400).json({
                    error: `Nomor ONU ID #${onuId} Tidak Valid!`,
                    details: `Batas maksimal ONU adalah 128 per port GPON (rentang 1 - 128). Tidak dapat mendaftarkan ONU melebihi nomor 128 pada port ini.`
                });
            }

            // Periksa kapasitas port dan ketersediaan ID di OLT
            const idInfo = await getAvailableOnuId(snmpHost, snmpPort, snmpComm, card, ponPort);
            if (idInfo.totalUsed >= 128) {
                return res.status(400).json({
                    error: `Port GPON Telah Penuh! (Maksimal 128 ONU)`,
                    details: `Interface gpon-olt_1/${card}/${ponPort} sudah mencapai kapasitas penuh (${idInfo.totalUsed}/128 ONU). Registrasi baru pada card dan port yang sama tidak dapat dilakukan.`
                });
            }

            if (idInfo.usedIds && idInfo.usedIds.includes(targetOnuId)) {
                return res.status(400).json({
                    error: `Nomor ONU ID #${targetOnuId} Sudah Digunakan!`,
                    details: `ONU #${targetOnuId} pada interface gpon-olt_1/${card}/${ponPort} sudah aktif di OLT. Silakan gunakan ID lain atau biarkan sistem memilih otomatis.`
                });
            }
        } else {
            console.log(`[BACKEND-AUTO] Mencari nomor ONU ID kosong pada Card ${card} Port ${ponPort} via SNMP...`);
            const idInfo = await getAvailableOnuId(snmpHost, snmpPort, snmpComm, card, ponPort);

            // Validasi jika port sudah penuh (Maksimal 128 ONU per port GPON)
            if (idInfo.isFull || !idInfo.nextAvailableOnuId || idInfo.nextAvailableOnuId > 128 || idInfo.totalUsed >= 128) {
                console.warn(`[REJECT-FULL] Port gpon-olt_1/${card}/${ponPort} telah PENUH (${idInfo.totalUsed}/128 ONU). Registrasi ditolak.`);
                return res.status(400).json({
                    error: `Port GPON Telah Penuh! (Maksimal 128 ONU)`,
                    details: `Interface gpon-olt_1/${card}/${ponPort} telah mencapai batas kapasitas maksimal 128 ONU (${idInfo.totalUsed}/128 terdaftar). Registrasi pada card dan port yang sama tidak dapat dilakukan.`
                });
            }

            targetOnuId = idInfo.nextAvailableOnuId;
            console.log(`[BACKEND-AUTO] Menemukan ID #${targetOnuId} kosong untuk dialokasikan pada gpon-olt_1/${card}/${ponPort}.`);
        }

        const host = process.env.OLT_SSH_HOST || process.env.SNMP_IP;
        const sshPort = parseInt(process.env.OLT_SSH_PORT, 10) || 22;
        const username = process.env.OLT_SSH_USER;
        const password = process.env.OLT_SSH_PASS;
        const type = onuType || process.env.DEFAULT_ONU_TYPE || 'ZTEG-F609';

        if (!password) {
            return res.status(400).json({
                error: 'Password SSH belum disetel di .env',
                details: 'Silakan isi parameter OLT_SSH_PASS pada file .env lalu coba kembali.'
            });
        }

        const result = await registerOnu({
            host,
            port: sshPort,
            username,
            password,
            slot: card,
            ponPort,
            onuId: targetOnuId,
            onuType: type,
            sn,
            vlan: req.body.vlan,
            pppoeUsername: req.body.username || req.body.pppoeUsername,
            pppoePassword: req.body.password || req.body.pppoePassword,
        });

        // Simpan setiap registrasi ke database SQLite
        let dbRecord = null;
        try {
            dbRecord = await saveRegisteredOnu({
                card,
                port: ponPort,
                onuId: targetOnuId,
                sn,
                onuType: type,
                interfaceName: `gpon-olt_1/${card}/${ponPort}`
            });
            console.log(`[DATABASE] Berhasil mencatat ONU #${targetOnuId} (${sn}) ke SQLite (ID DB: ${dbRecord.id})`);
        } catch (dbErr) {
            console.error('[DATABASE ERROR] Gagal menyimpan ke SQLite:', dbErr.message);
        }

        res.json({
            ...result,
            onuId: targetOnuId,
            onuType: type,
            sn,
            interface: `gpon-olt_1/${card}/${ponPort}`,
            dbId: dbRecord ? dbRecord.id : null
        });
    } catch (error) {
        console.error('Register ONU via SSH Error:', error);
        res.status(500).json({ error: error.message || 'Gagal registrasi ONU ke OLT' });
    }
});

// Endpoint untuk mengambil seluruh daftar modem yang tercatat di database SQLite
app.get('/api/registered', async (req, res) => {
    try {
        const list = await getRegisteredOnus();
        res.json(list);
    } catch (error) {
        console.error('Fetch Registered ONUs Error:', error);
        res.status(500).json({ error: error.message || 'Gagal mengambil data dari database' });
    }
});

// Endpoint untuk menghapus (delete) ONU dari ZTE OLT via SSH dan database
app.post('/api/delete-onu', async (req, res) => {
    try {
        const { id, card, port: ponPort, onuId } = req.body;

        let targetCard = card;
        let targetPort = ponPort;
        let targetOnuId = onuId;
        let record = null;

        if (id) {
            record = await getRegisteredOnuById(id);
            if (record) {
                targetCard = targetCard || record.card;
                targetPort = targetPort || record.port;
                targetOnuId = targetOnuId || record.onu_id;
            }
        }

        if (!targetCard || !targetPort || !targetOnuId) {
            return res.status(400).json({ error: 'Parameter card, port, dan onuId wajib diisi' });
        }

        const host = process.env.OLT_SSH_HOST || process.env.SNMP_IP;
        const sshPort = parseInt(process.env.OLT_SSH_PORT, 10) || 22;
        const username = process.env.OLT_SSH_USER;
        const password = process.env.OLT_SSH_PASS;

        if (!password) {
            return res.status(400).json({ error: 'Password SSH belum disetel di .env' });
        }

        // 1. Eksekusi perintah hapus di ZTE OLT via SSH (no onu <id>)
        const result = await deleteOnu({
            host,
            port: sshPort,
            username,
            password,
            slot: targetCard,
            ponPort: targetPort,
            onuId: targetOnuId
        });

        // 2. Hapus dari database SQLite jika ada ID
        if (id) {
            await deleteRegisteredOnu(id);
            console.log(`[DATABASE] Berhasil menghapus record ID #${id} (ONU #${targetOnuId}) dari SQLite.`);
        }

        res.json({
            ...result,
            card: targetCard,
            port: targetPort,
            onuId: targetOnuId,
            interface: `gpon-olt_1/${targetCard}/${targetPort}`
        });
    } catch (error) {
        console.error('Delete ONU via SSH Error:', error);
        res.status(500).json({ error: error.message || 'Gagal menghapus ONU dari OLT' });
    }
});

// Endpoint untuk membaca daya sinyal optik / laser (Rx & Tx Power) ONU via SNMP
app.get('/api/onu-laser', async (req, res) => {
    try {
        const { card, port: ponPort, onuId } = req.query;

        if (!card || !ponPort || !onuId) {
            return res.status(400).json({ error: 'Parameter card, port, dan onuId wajib diisi' });
        }

        const snmpHost = process.env.SNMP_IP || '127.0.0.1';
        const snmpPort = parseInt(process.env.SNMP_PORT, 10) || 161;
        const snmpComm = process.env.SNMP_COMMUNITY || 'public';

        const laserInfo = await getOnuLaser(snmpHost, snmpPort, snmpComm, card, ponPort, onuId);
        res.json(laserInfo);
    } catch (error) {
        console.error('Fetch ONU Laser Error:', error);
        res.status(500).json({ error: error.message || 'Gagal membaca status laser dari OLT' });
    }
});

// Inisialisasi DB SQLite sebelum server listen
initDb().then(() => {
    console.log('[DATABASE] SQLite registered_onus siap digunakan.');
}).catch((err) => {
    console.error('[DATABASE] Gagal inisialisasi SQLite:', err.message);
});

app.listen(port, () => {
    const filter = getTargetFilter();
    console.log(`Server berjalan di http://localhost:${port}`);
    if (filter.active) {
        console.log(`🔒 [Filter Terkunci] ${filter.displayText}`);
    } else {
        console.log(`🌐 [Filter] Memindai seluruh Card dan Port (Tanpa kunci)`);
    }
});
