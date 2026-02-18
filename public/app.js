document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-btn');
    const onuList = document.getElementById('onu-list');
    const loading = document.getElementById('loading');
    const errorContainer = document.getElementById('error-container');
    const errorMsg = document.getElementById('error-msg');
    const appStatusDot = document.querySelector('#app-status .dot');
    const appStatusText = document.querySelector('#app-status .status-text');

    const fetchUnconfigured = async () => {
        // Reset state
        onuList.innerHTML = '';
        loading.classList.remove('hidden');
        errorContainer.classList.add('hidden');
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
        
        appStatusDot.style.background = '#eab308'; // Warning color (Yellow)
        appStatusDot.style.boxShadow = '0 0 10px #eab308';
        appStatusText.innerText = 'Scanning...';

        try {
            const response = await fetch('/api/unconfigured');
            if (!response.ok) throw new Error('Gagal menghubungi server');
            
            const data = await response.json();
            
            renderData(data);
            
            appStatusDot.style.background = '#22c55e'; // Success color
            appStatusDot.style.boxShadow = '0 0 10px #22c55e';
            appStatusText.innerText = 'Ready';
        } catch (error) {
            errorMsg.innerText = error.message;
            errorContainer.classList.remove('hidden');
            onuList.innerHTML = '<tr><td colspan="5" class="empty-msg">Error mendeteksi modem.</td></tr>';
            
            appStatusDot.style.background = '#ef4444'; // Danger color
            appStatusDot.style.boxShadow = '0 0 10px #ef4444';
            appStatusText.innerText = 'Error';
        } finally {
            loading.classList.add('hidden');
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Scan Sekarang';
        }
    };

    const renderData = (data) => {
        if (!data || data.length === 0 || data[0].onu_id === 'Empty') {
            onuList.innerHTML = '<tr><td colspan="5" class="empty-msg">Tidak ada modem unconfigured ditemukan.</td></tr>';
            return;
        }

        if (data[0].value === 'SNMP Extension missing' || data[0].onu_id === 'Error') {
            onuList.innerHTML = `<tr><td colspan="5" class="empty-msg" style="color: #ef4444;">${data[0].value}</td></tr>`;
            return;
        }

        onuList.innerHTML = data.map(item => `
            <tr class="fade-in">
                <td>${item.no}</td>
                <td><strong style="color: #fff;">${item.value}</strong></td>
                <td><span class="badge">${item.onu_id}</span></td>
                <td style="font-family: monospace; font-size: 0.8rem; color: #94a3b8;">${item.raw_value || '-'}</td>
                <td>
                    <button class="btn-copy" onclick="copyToClipboard('${item.value}')" title="Salin SN">
                        <i class="far fa-copy"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    };

    window.copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            alert('Serial Number disalin: ' + text);
        });
    };

    refreshBtn.addEventListener('click', fetchUnconfigured);
});
