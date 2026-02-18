const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getUnconfigured } = require('./snmp');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/unconfigured', async (req, res) => {
    try {
        const ip = process.env.SNMP_IP;
        const snmpPort = parseInt(process.env.SNMP_PORT) || 161;
        const community = process.env.SNMP_COMMUNITY;

        const data = await getUnconfigured(ip, snmpPort, community);
        res.json(data);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Gagal mengambil data SNMP', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
