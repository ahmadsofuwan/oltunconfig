document.addEventListener('DOMContentLoaded', () => {
    // Navigasi Tab
    const tabUnconfigured = document.getElementById('tab-unconfigured');
    const tabRegistered = document.getElementById('tab-registered');
    const sectionUnconfigured = document.getElementById('section-unconfigured');
    const sectionRegistered = document.getElementById('section-registered');
    const badgeUnconfCount = document.getElementById('badge-unconf-count');
    const badgeRegCount = document.getElementById('badge-reg-count');

    // Komponen Unconfigured
    const refreshBtn = document.getElementById('refresh-btn');
    const onuList = document.getElementById('onu-list');
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');
    const errorContainer = document.getElementById('error-container');
    const errorMsg = document.getElementById('error-msg');
    const appStatusDot = document.querySelector('#app-status .dot');
    const appStatusText = document.querySelector('#app-status .status-text');
    const filterBadge = document.getElementById('filter-badge');
    const filterText = document.getElementById('filter-text');
    const btnModeAll = document.getElementById('btn-mode-all');
    const btnModeEnv = document.getElementById('btn-mode-env');
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');

    // Toolbar & Pencarian SN
    const searchUnconf = document.getElementById('search-unconf');
    const clearSearchUnconf = document.getElementById('clear-search-unconf');
    const unconfCounter = document.getElementById('unconf-counter');

    const searchReg = document.getElementById('search-reg');
    const clearSearchReg = document.getElementById('clear-search-reg');
    const regCounter = document.getElementById('reg-counter');

    let allUnconfData = [];
    let allRegisteredData = [];

    // Komponen Modem Terdaftar
    const refreshRegBtn = document.getElementById('refresh-reg-btn');
    const registeredList = document.getElementById('registered-list');
    const regTableLoading = document.getElementById('reg-table-loading');

    // Modal Registrasi (Popup Konfirmasi)
    const regModal = document.getElementById('reg-modal');
    const regForm = document.getElementById('reg-form');
    const modalConfirmContent = document.getElementById('modal-confirm-content');
    const confirmSn = document.getElementById('confirm-sn');
    const confirmInterface = document.getElementById('confirm-interface');
    const regSn = document.getElementById('reg-sn');
    const regCard = document.getElementById('reg-card');
    const regPort = document.getElementById('reg-port');
    const regOnuId = document.getElementById('reg-onu-id');
    const regOnuType = document.getElementById('reg-onu-type');
    const regLoading = document.getElementById('reg-loading');
    const regResult = document.getElementById('reg-result');
    const regResultTitle = document.getElementById('reg-result-title');
    const regResultDesc = document.getElementById('reg-result-desc');
    const modalFooter = document.getElementById('modal-footer');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const btnSubmitReg = document.getElementById('btn-submit-reg');

    // Modal Hapus ONU (Delete via SSH)
    const deleteModal = document.getElementById('delete-modal');
    const deleteForm = document.getElementById('delete-form');
    const delId = document.getElementById('del-id');
    const delCard = document.getElementById('del-card');
    const delPort = document.getElementById('del-port');
    const delOnuId = document.getElementById('del-onuid');
    const delConfirmSn = document.getElementById('del-confirm-sn');
    const delConfirmInterface = document.getElementById('del-confirm-interface');
    const delConfirmOnuId = document.getElementById('del-confirm-onuid');
    const modalDeleteContent = document.getElementById('modal-delete-content');
    const deleteLoading = document.getElementById('delete-loading');
    const deleteResult = document.getElementById('delete-result');
    const delResultTitle = document.getElementById('del-result-title');
    const delResultDesc = document.getElementById('del-result-desc');
    const delModalFooter = document.getElementById('del-modal-footer');
    const btnCloseDeleteModal = document.getElementById('btn-close-delete-modal');
    const btnCancelDelete = document.getElementById('btn-cancel-delete');
    const btnSubmitDelete = document.getElementById('btn-submit-delete');

    let toastTimer = null;
    let currentMode = 'env'; // 'env' atau 'all'

    /**
     * Tampilkan toast notification
     */
    const showToast = (message) => {
        if (toastTimer) clearTimeout(toastTimer);
        toastMsg.innerText = message;
        toast.classList.remove('hidden');
        toastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    };

    /**
     * Navigasi antar Tab
     */
    const switchTab = (tab) => {
        if (tab === 'unconfigured') {
            tabUnconfigured.classList.add('active');
            tabRegistered.classList.remove('active');
            sectionUnconfigured.classList.remove('hidden');
            sectionRegistered.classList.add('hidden');
        } else {
            tabRegistered.classList.add('active');
            tabUnconfigured.classList.remove('active');
            sectionRegistered.classList.remove('hidden');
            sectionUnconfigured.classList.add('hidden');
            fetchRegistered();
        }
    };

    if (tabUnconfigured) tabUnconfigured.addEventListener('click', () => switchTab('unconfigured'));
    if (tabRegistered) tabRegistered.addEventListener('click', () => switchTab('registered'));

    /**
     * Sorot teks yang cocok dengan kata kunci pencarian
     */
    const highlightMatch = (text, query) => {
        if (!query || !text) return text;
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return String(text).replace(regex, '<span class="highlight-match">$1</span>');
    };

    /**
     * Filter data modem unconfigured berdasarkan Serial Number (SN)
     */
    const filterUnconf = () => {
        const query = searchUnconf ? searchUnconf.value.trim().toLowerCase() : '';
        if (clearSearchUnconf) {
            clearSearchUnconf.classList.toggle('hidden', query === '');
        }

        if (!allUnconfData || allUnconfData.length === 0) {
            renderData([]);
            return;
        }

        // Jika data error atau kosong dari SNMP
        if (allUnconfData[0].empty || allUnconfData[0].onu_id === 'Empty' || (typeof allUnconfData[0].value === 'string' && allUnconfData[0].value.startsWith('Modem tidak ditemukan'))) {
            renderData(allUnconfData);
            return;
        }

        if (!query) {
            renderData(allUnconfData);
            return;
        }

        const filtered = allUnconfData.filter(item => {
            const sn = (item.value || '').toLowerCase();
            return sn.includes(query);
        });

        renderData(filtered, null, query);
    };

    /**
     * Render daftar data modem unconfigured ke tabel
     */
    const renderData = (data, filter, searchQuery = '') => {
        if (!data || data.length === 0) {
            if (searchQuery) {
                onuList.innerHTML = `<tr><td colspan="5" class="empty-msg"><i class="fas fa-search" style="font-size: 1.5rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>Tidak ditemukan modem dengan SN "<strong>${searchQuery}</strong>"</td></tr>`;
                if (unconfCounter) unconfCounter.innerText = `Ditemukan: 0 modem`;
            } else {
                onuList.innerHTML = `<tr><td colspan="5" class="empty-msg">Tidak ada modem unconfigured ditemukan.</td></tr>`;
                if (unconfCounter) unconfCounter.innerText = `Total: 0 modem`;
            }
            if (badgeUnconfCount && !searchQuery) badgeUnconfCount.innerText = '0';
            return;
        }

        if (data[0].empty || data[0].onu_id === 'Empty' || (typeof data[0].value === 'string' && data[0].value.startsWith('Modem tidak ditemukan'))) {
            const msg = data && data[0] && data[0].value ? data[0].value : 'Tidak ada modem unconfigured ditemukan.';
            onuList.innerHTML = `<tr><td colspan="5" class="empty-msg">${msg}</td></tr>`;
            if (unconfCounter) unconfCounter.innerText = `Total: 0 modem`;
            if (badgeUnconfCount) badgeUnconfCount.innerText = '0';
            return;
        }

        if (data[0].value === 'SNMP Extension missing' || data[0].onu_id === 'Error') {
            onuList.innerHTML = `<tr><td colspan="5" class="empty-msg" style="color: #ef4444;">${data[0].value}</td></tr>`;
            if (unconfCounter) unconfCounter.innerText = `Error`;
            if (badgeUnconfCount) badgeUnconfCount.innerText = '0';
            return;
        }

        if (badgeUnconfCount && !searchQuery) badgeUnconfCount.innerText = String(data.length);
        if (unconfCounter) {
            unconfCounter.innerText = searchQuery
                ? `Ditemukan: ${data.length} dari ${allUnconfData.length} modem`
                : `Total: ${data.length} modem`;
        }

        onuList.innerHTML = data.map((item, idx) => {
            const locationLabel = item.onu_id || (item.card ? `Card ${item.card} / Port ${item.port}` : '-');
            const interfaceHint = item.interface ? `<div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">${item.interface}</div>` : '';
            const slotNum = item.card || item.slot || 3;
            const portNum = item.port || 1;
            const snFormatted = searchQuery ? highlightMatch(item.value, searchQuery) : item.value;

            return `
                <tr class="fade-in">
                    <td>${idx + 1}</td>
                    <td><strong style="color: #fff; font-size: 1.05rem; letter-spacing: 0.5px;">${snFormatted}</strong></td>
                    <td>
                        <span class="badge">${locationLabel}</span>
                        ${interfaceHint}
                    </td>
                    <td style="font-family: monospace; font-size: 0.8rem; color: #94a3b8;">${item.raw_value || '-'}</td>
                    <td>
                        <div class="action-group">
                            <button class="btn-copy" onclick="copyToClipboard('${item.value}')" title="Salin Serial Number">
                                <i class="far fa-copy"></i>
                            </button>
                            <button class="btn-register" onclick="openRegisterModal('${item.value}', ${slotNum}, ${portNum})" title="Daftarkan (Reg) ke OLT">
                                <i class="fas fa-plus-circle"></i> Reg
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    window.copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Serial Number disalin: ' + text);
        }).catch(() => {
            showToast('SN: ' + text);
        });
    };

    /**
     * Filter data modem terdaftar berdasarkan Serial Number (SN)
     */
    const filterRegistered = () => {
        const query = searchReg ? searchReg.value.trim().toLowerCase() : '';
        if (clearSearchReg) {
            clearSearchReg.classList.toggle('hidden', query === '');
        }

        if (!allRegisteredData || allRegisteredData.length === 0) {
            renderRegistered([]);
            return;
        }

        if (!query) {
            renderRegistered(allRegisteredData);
            return;
        }

        const filtered = allRegisteredData.filter(item => {
            const sn = (item.sn || '').toLowerCase();
            return sn.includes(query);
        });

        renderRegistered(filtered, query);
    };

    /**
     * Render daftar data modem terdaftar ke tabel
     */
    const renderRegistered = (list, searchQuery = '') => {
        if (!list || list.length === 0) {
            if (searchQuery) {
                registeredList.innerHTML = `<tr><td colspan="7" class="empty-msg"><i class="fas fa-search" style="font-size: 1.5rem; opacity: 0.4; margin-bottom: 8px; display: block;"></i>Tidak ditemukan modem terdaftar dengan SN "<strong>${searchQuery}</strong>"</td></tr>`;
                if (regCounter) regCounter.innerText = `Ditemukan: 0 modem`;
            } else {
                registeredList.innerHTML = `<tr><td colspan="7" class="empty-msg">Belum ada modem yang terdaftar. Silakan klik tombol <strong>Reg</strong> pada menu Modem Belum Terdaftar.</td></tr>`;
                if (regCounter) regCounter.innerText = `Total: 0 modem`;
            }
            if (badgeRegCount && !searchQuery) badgeRegCount.innerText = '0';
            return;
        }

        if (badgeRegCount && !searchQuery) badgeRegCount.innerText = String(list.length);
        if (regCounter) {
            regCounter.innerText = searchQuery
                ? `Ditemukan: ${list.length} dari ${allRegisteredData.length} modem`
                : `Total: ${list.length} modem`;
        }

        registeredList.innerHTML = list.map((item, idx) => {
            const snFormatted = searchQuery ? highlightMatch(item.sn, searchQuery) : item.sn;

            return `
                <tr class="fade-in">
                    <td>${idx + 1}</td>
                    <td><strong style="color: #38bdf8; font-family: monospace; font-size: 1rem;">${snFormatted}</strong></td>
                    <td><span class="badge">${item.interface || ('gpon-olt_1/' + item.card + '/' + item.port)}</span></td>
                    <td><span class="badge-mini" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; font-weight: 700;">#${item.onu_id}</span></td>
                    <td><span style="color: #cbd5e1; font-size: 0.85rem;">${item.onu_type || 'ZTEG-F609'}</span></td>
                    <td style="color: #94a3b8; font-size: 0.82rem;">${item.created_at || '-'}</td>
                    <td>
                        <div class="action-group">
                            <button class="btn-laser" onclick="openLaserModal(${item.card}, ${item.port}, ${item.onu_id}, '${item.sn}')" title="Cek Sinyal Laser (Rx/Tx Power)">
                                <i class="fas fa-satellite-dish"></i> Sinyal
                            </button>
                            <button class="btn-delete-onu" onclick="openDeleteModal(${item.id}, ${item.card}, ${item.port}, ${item.onu_id}, '${item.sn}')" title="Hapus modem dari OLT">
                                <i class="fas fa-trash-alt"></i> Hapus
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    /**
     * Ambil data modem terdaftar dari server
     */
    const fetchRegistered = async () => {
        if (regTableLoading) regTableLoading.classList.remove('hidden');

        try {
            const res = await fetch('/api/registered');
            if (!res.ok) throw new Error('Gagal memuat data modem terdaftar');
            const list = await res.json();
            allRegisteredData = list || [];
            filterRegistered();
        } catch (err) {
            registeredList.innerHTML = `<tr><td colspan="7" class="empty-msg" style="color: #ef4444;">Gagal memuat data: ${err.message}</td></tr>`;
        } finally {
            if (regTableLoading) regTableLoading.classList.add('hidden');
        }
    };

    // Event listener input pencarian SN
    if (searchUnconf) {
        searchUnconf.addEventListener('input', filterUnconf);
    }
    if (clearSearchUnconf) {
        clearSearchUnconf.addEventListener('click', () => {
            searchUnconf.value = '';
            filterUnconf();
            searchUnconf.focus();
        });
    }

    if (searchReg) {
        searchReg.addEventListener('input', filterRegistered);
    }
    if (clearSearchReg) {
        clearSearchReg.addEventListener('click', () => {
            searchReg.value = '';
            filterRegistered();
            searchReg.focus();
        });
    }

    if (refreshRegBtn) refreshRegBtn.addEventListener('click', fetchRegistered);

    /**
     * Buka modal dialog konfirmasi registrasi ONU
     */
    window.openRegisterModal = (sn, card, port) => {
        if (regSn) regSn.value = sn;
        if (regCard) regCard.value = card;
        if (regPort) regPort.value = port;
        if (confirmSn) confirmSn.innerText = sn;
        if (confirmInterface) confirmInterface.innerText = `gpon-olt_1/${card}/${port}`;

        if (regOnuId) regOnuId.value = '';
        if (regOnuType) regOnuType.value = 'ZTEG-F609';

        if (modalConfirmContent) modalConfirmContent.classList.remove('hidden');
        if (modalFooter) modalFooter.classList.remove('hidden');
        if (regLoading) regLoading.classList.add('hidden');
        if (regResult) regResult.classList.add('hidden');

        if (btnSubmitReg) {
            btnSubmitReg.disabled = false;
            btnSubmitReg.innerHTML = '<i class="fas fa-check"></i> Ya, Daftarkan ke OLT';
        }

        regModal.classList.remove('hidden');
    };

    /**
     * Tutup modal registrasi
     */
    const closeModal = () => {
        regModal.classList.add('hidden');
    };

    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

    if (regModal) {
        regModal.addEventListener('click', (e) => {
            if (e.target === regModal) closeModal();
        });
    }

    /**
     * Submit konfirmasi registrasi ke OLT via SSH
     */
    if (regForm) {
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const card = regCard.value;
            const port = regPort.value;
            const sn = regSn.value;
            const onuType = regOnuType ? regOnuType.value || 'ZTEG-F609' : 'ZTEG-F609';

            if (modalConfirmContent) modalConfirmContent.classList.add('hidden');
            if (modalFooter) modalFooter.classList.add('hidden');
            if (regResult) regResult.classList.add('hidden');
            if (regLoading) regLoading.classList.remove('hidden');

            try {
                const res = await fetch('/api/register-onu', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ card, port, sn, onuType })
                });

                const result = await res.json();

                if (regLoading) regLoading.classList.add('hidden');

                if (res.ok && result.success) {
                    regResult.className = 'result-box success';
                    regResultTitle.innerText = 'Registrasi Berhasil Diproses!';
                    const assignedId = result.onuId || 'Auto';
                    regResultDesc.innerHTML = `Modem <strong>${sn}</strong> berhasil didaftarkan sebagai <strong>ONU #${assignedId}</strong> pada interface <strong>${result.interface || ('gpon-olt_1/' + card + '/' + port)}</strong>.`;
                    regResult.classList.remove('hidden');

                    showToast(`ONU #${assignedId} (${sn}) berhasil didaftarkan!`);

                    setTimeout(() => {
                        closeModal();
                        fetchUnconfigured();
                        fetchRegistered();
                    }, 1800);
                } else {
                    regResult.className = 'result-box error';
                    regResultTitle.innerText = result.error || 'Gagal Mendaftarkan ke OLT';
                    regResultDesc.innerHTML = `<span style="font-weight: 600;">${result.error || 'Terjadi kesalahan saat registrasi.'}</span>${result.details ? `<br><span style="font-size: 0.85rem; opacity: 0.9; margin-top: 5px; display: inline-block;">${result.details}</span>` : ''}`;
                    regResult.classList.remove('hidden');

                    if (modalConfirmContent) modalConfirmContent.classList.remove('hidden');
                    if (modalFooter) modalFooter.classList.remove('hidden');
                }
            } catch (err) {
                if (regLoading) regLoading.classList.add('hidden');
                regResult.className = 'result-box error';
                regResultTitle.innerText = 'Kesalahan Jaringan';
                regResultDesc.innerText = err.message || 'Tidak dapat menghubungi server lokal.';
                regResult.classList.remove('hidden');

                if (modalConfirmContent) modalConfirmContent.classList.remove('hidden');
                if (modalFooter) modalFooter.classList.remove('hidden');
            }
        });
    }

    /**
     * Buka modal konfirmasi hapus ONU
     */
    window.openDeleteModal = (id, card, port, onuId, sn) => {
        if (delId) delId.value = id;
        if (delCard) delCard.value = card;
        if (delPort) delPort.value = port;
        if (delOnuId) delOnuId.value = onuId;
        if (delConfirmSn) delConfirmSn.innerText = sn;
        if (delConfirmInterface) delConfirmInterface.innerText = `gpon-olt_1/${card}/${port}`;
        if (delConfirmOnuId) delConfirmOnuId.innerText = `ONU #${onuId}`;

        if (modalDeleteContent) modalDeleteContent.classList.remove('hidden');
        if (delModalFooter) delModalFooter.classList.remove('hidden');
        if (deleteLoading) deleteLoading.classList.add('hidden');
        if (deleteResult) deleteResult.classList.add('hidden');

        if (btnSubmitDelete) {
            btnSubmitDelete.disabled = false;
            btnSubmitDelete.innerHTML = '<i class="fas fa-trash-alt"></i> Ya, Hapus ONU dari OLT';
        }

        deleteModal.classList.remove('hidden');
    };

    const closeDeleteModal = () => {
        deleteModal.classList.add('hidden');
    };

    if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener('click', closeDeleteModal);
    if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteModal);

    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
    }

    /**
     * Submit konfirmasi hapus ONU ke OLT via SSH
     */
    if (deleteForm) {
        deleteForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const id = delId.value;
            const card = delCard.value;
            const port = delPort.value;
            const onuId = delOnuId.value;

            if (modalDeleteContent) modalDeleteContent.classList.add('hidden');
            if (delModalFooter) delModalFooter.classList.add('hidden');
            if (deleteResult) deleteResult.classList.add('hidden');
            if (deleteLoading) deleteLoading.classList.remove('hidden');

            try {
                const res = await fetch('/api/delete-onu', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, card, port, onuId })
                });

                const result = await res.json();

                if (deleteLoading) deleteLoading.classList.add('hidden');

                if (res.ok && result.success) {
                    deleteResult.className = 'result-box success';
                    delResultTitle.innerText = 'Modem Berhasil Dihapus!';
                    delResultDesc.innerHTML = `Modem <strong>ONU #${onuId}</strong> berhasil dihapus dari interface <strong>${result.interface || ('gpon-olt_1/' + card + '/' + port)}</strong>.`;
                    deleteResult.classList.remove('hidden');

                    showToast(`ONU #${onuId} berhasil dihapus dari OLT!`);

                    setTimeout(() => {
                        closeDeleteModal();
                        fetchRegistered();
                        fetchUnconfigured();
                    }, 1800);
                } else {
                    deleteResult.className = 'result-box error';
                    delResultTitle.innerText = 'Gagal Menghapus Modem';
                    delResultDesc.innerText = result.error || 'Terjadi kesalahan saat menghapus modem dari OLT.';
                    deleteResult.classList.remove('hidden');

                    if (modalDeleteContent) modalDeleteContent.classList.remove('hidden');
                    if (delModalFooter) delModalFooter.classList.remove('hidden');
                }
            } catch (err) {
                if (deleteLoading) deleteLoading.classList.add('hidden');
                deleteResult.className = 'result-box error';
                delResultTitle.innerText = 'Kesalahan Jaringan';
                delResultDesc.innerText = err.message;
                deleteResult.classList.remove('hidden');

                if (modalDeleteContent) modalDeleteContent.classList.remove('hidden');
                if (delModalFooter) delModalFooter.classList.remove('hidden');
            }
        });
    }

    // Elemen Laser Modal
    const laserModal = document.getElementById('laser-modal');
    const laserQueryCard = document.getElementById('laser-query-card');
    const laserQueryPort = document.getElementById('laser-query-port');
    const laserQueryOnuId = document.getElementById('laser-query-onuid');
    const laserModalSn = document.getElementById('laser-modal-sn');
    const laserModalInterface = document.getElementById('laser-modal-interface');
    const laserModalStatus = document.getElementById('laser-modal-status');
    const laserModalIp = document.getElementById('laser-modal-ip');
    const btnCopyLaserIp = document.getElementById('btn-copy-laser-ip');
    const laserModalExtraIps = document.getElementById('laser-modal-extra-ips');
    const laserModalLoading = document.getElementById('laser-modal-loading');
    const laserMetricsDisplay = document.getElementById('laser-metrics-display');
    const laserRxVal = document.getElementById('laser-rx-val');
    const laserRxBadge = document.getElementById('laser-rx-badge');
    const laserSignalBar = document.getElementById('laser-signal-bar');
    const laserTxVal = document.getElementById('laser-tx-val');
    const btnRefreshLaser = document.getElementById('btn-refresh-laser');
    const btnCloseLaserModal = document.getElementById('btn-close-laser-modal');
    const btnDoneLaser = document.getElementById('btn-done-laser');

    window.showToast = showToast;

    /**
     * Buka Modal Cek Sinyal Laser
     */
    window.openLaserModal = (card, port, onuId, sn) => {
        if (laserQueryCard) laserQueryCard.value = card;
        if (laserQueryPort) laserQueryPort.value = port;
        if (laserQueryOnuId) laserQueryOnuId.value = onuId;
        if (laserModalSn) laserModalSn.innerText = sn;
        if (laserModalInterface) laserModalInterface.innerText = `gpon-olt_1/${card}/${port}:${onuId}`;

        if (laserModalIp) {
            laserModalIp.innerText = 'Memeriksa SNMP...';
            laserModalIp.style.color = '#94a3b8';
        }
        if (btnCopyLaserIp) btnCopyLaserIp.classList.add('hidden');
        if (laserModalExtraIps) {
            laserModalExtraIps.innerHTML = '';
            laserModalExtraIps.classList.add('hidden');
        }

        if (laserModalLoading) laserModalLoading.classList.remove('hidden');
        if (laserMetricsDisplay) laserMetricsDisplay.classList.add('hidden');
        if (laserModalStatus) {
            laserModalStatus.innerText = 'Membaca SNMP...';
            laserModalStatus.className = 'badge-mini';
        }

        if (laserModal) laserModal.classList.remove('hidden');

        fetchLaserData(card, port, onuId);
    };

    const fetchLaserData = async (card, port, onuId) => {
        if (laserModalLoading) laserModalLoading.classList.remove('hidden');
        if (laserMetricsDisplay) laserMetricsDisplay.classList.add('hidden');

        try {
            const res = await fetch(`/api/onu-laser?card=${card}&port=${port}&onuId=${onuId}`);
            if (!res.ok) throw new Error('Gagal mengambil data laser dari OLT');
            const data = await res.json();

            // Set Status ONU
            if (laserModalStatus) {
                laserModalStatus.innerText = data.statusText || 'Unknown';
                laserModalStatus.className = `badge-mini ${data.statusColor === 'success' ? '' : 'warning'}`;
            }

            // Set IP Address ONU (Management / WAN IP dari SNMP OLT)
            if (laserModalIp) {
                if (data.ip) {
                    laserModalIp.innerText = data.ip;
                    laserModalIp.style.color = '#38bdf8';
                    if (btnCopyLaserIp) {
                        btnCopyLaserIp.classList.remove('hidden');
                        btnCopyLaserIp.onclick = () => {
                            navigator.clipboard.writeText(data.ip).then(() => {
                                showToast(`IP ${data.ip} disalin!`);
                            }).catch(() => {
                                showToast(`IP: ${data.ip}`);
                            });
                        };
                    }
                } else {
                    laserModalIp.innerText = data.ipDisplay || (data.statusPhase === 3 ? 'Belum Ada IP' : 'Offline / Tidak Ada IP');
                    laserModalIp.style.color = '#94a3b8';
                    if (btnCopyLaserIp) btnCopyLaserIp.classList.add('hidden');
                }
            }

            // Tampilkan IP Tambahan jika ada lebih dari 1 IP (misal TR069 atau Management)
            if (laserModalExtraIps) {
                const extraIps = [];
                if (data.wanIps && data.wanIps.length > 1) {
                    data.wanIps.slice(1).forEach((wIp, idx) => {
                        extraIps.push({ label: `WAN ${idx + 2}`, ip: wIp });
                    });
                }
                if (data.mgmtIp && data.mgmtIp !== data.ip && !extraIps.some(e => e.ip === data.mgmtIp)) {
                    extraIps.push({ label: 'Mgmt', ip: data.mgmtIp });
                }

                if (extraIps.length > 0) {
                    laserModalExtraIps.innerHTML = extraIps.map(item => `
                        <span class="badge-mini" style="background: rgba(56, 189, 248, 0.12); color: #7dd3fc; border-color: rgba(56, 189, 248, 0.25); font-family: monospace; font-size: 0.72rem; cursor: pointer;" title="Klik untuk menyalin" onclick="navigator.clipboard.writeText('${item.ip}'); window.showToast('IP ${item.ip} disalin!');">
                            <i class="fas fa-network-wired" style="font-size: 0.65rem;"></i> ${item.label}: ${item.ip}
                        </span>
                    `).join('');
                    laserModalExtraIps.classList.remove('hidden');
                } else {
                    laserModalExtraIps.innerHTML = '';
                    laserModalExtraIps.classList.add('hidden');
                }
            }

            // Set Rx Power
            if (data.rx && data.rx.isOnline) {
                laserRxVal.innerText = data.rx.formatted;
                laserRxVal.className = `laser-val ${data.rx.quality}`;
                laserRxBadge.innerText = `${data.rx.qualityText} (${data.rx.formatted})`;
                laserRxBadge.className = `badge-mini ${data.rx.quality === 'good' ? '' : 'warning'}`;

                // Persentase sinyal bar (skala -30 dBm ke -10 dBm)
                let pct = Math.min(100, Math.max(10, Math.round(((30 + data.rx.dbm) / 20) * 100)));
                laserSignalBar.style.width = pct + '%';
                laserSignalBar.className = `signal-bar-fill ${data.rx.quality}`;
            } else {
                laserRxVal.innerText = 'LOS / Offline';
                laserRxVal.className = 'laser-val danger';
                laserRxBadge.innerText = 'Tidak Ada Sinyal Optik';
                laserRxBadge.className = 'badge-mini warning';
                laserSignalBar.style.width = '0%';
                laserSignalBar.className = 'signal-bar-fill danger';
            }

            // Set Tx Power
            if (data.tx && data.tx.isOnline) {
                laserTxVal.innerText = data.tx.formatted;
            } else {
                laserTxVal.innerText = 'Offline';
            }

            if (laserModalLoading) laserModalLoading.classList.add('hidden');
            if (laserMetricsDisplay) laserMetricsDisplay.classList.remove('hidden');
        } catch (err) {
            if (laserModalLoading) laserModalLoading.classList.add('hidden');
            if (laserModalStatus) {
                laserModalStatus.innerText = 'Error';
                laserModalStatus.className = 'badge-mini warning';
            }
            if (laserModalIp) {
                laserModalIp.innerText = '-';
                laserModalIp.style.color = '#ef4444';
            }
            if (btnCopyLaserIp) btnCopyLaserIp.classList.add('hidden');
            showToast('Gagal membaca laser: ' + err.message);
        }
    };

    const closeLaserModal = () => {
        if (laserModal) laserModal.classList.add('hidden');
    };

    if (btnCloseLaserModal) btnCloseLaserModal.addEventListener('click', closeLaserModal);
    if (btnDoneLaser) btnDoneLaser.addEventListener('click', closeLaserModal);
    if (btnRefreshLaser) {
        btnRefreshLaser.addEventListener('click', () => {
            fetchLaserData(laserQueryCard.value, laserQueryPort.value, laserQueryOnuId.value);
        });
    }

    if (laserModal) {
        laserModal.addEventListener('click', (e) => {
            if (e.target === laserModal) closeLaserModal();
        });
    }

    /**
     * Ambil data unconfigured modem dari SNMP
     */
    const fetchUnconfigured = async () => {
        loading.classList.remove('hidden');
        errorContainer.classList.add('hidden');
        onuList.innerHTML = '<tr><td colspan="5" class="empty-msg">Memindai data modem unconfigured...</td></tr>';
        refreshBtn.disabled = true;

        try {
            const queryParam = currentMode === 'all' ? '?card=all&port=all' : '';
            const res = await fetch(`/api/unconfigured${queryParam}`);
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            const result = await res.json();

            appStatusDot.className = 'dot online';
            appStatusText.innerText = 'Online';

            if (result.filter) {
                filterText.innerText = result.filter.displayText || 'Semua Port';
                if (result.filter.active && currentMode === 'env') {
                    filterBadge.className = 'filter-tag active';
                } else {
                    filterBadge.className = 'filter-tag';
                }
            }

            allUnconfData = result.data || [];
            filterUnconf();
        } catch (err) {
            appStatusDot.className = 'dot offline';
            appStatusText.innerText = 'Error';
            errorContainer.classList.remove('hidden');
            errorMsg.innerText = err.message || 'Gagal terhubung ke OLT via SNMP';
            onuList.innerHTML = '<tr><td colspan="5" class="empty-msg" style="color: #ef4444;">Gagal mengambil data.</td></tr>';
        } finally {
            loading.classList.add('hidden');
            refreshBtn.disabled = false;
        }
    };

    if (btnModeAll && btnModeEnv) {
        btnModeAll.addEventListener('click', () => {
            currentMode = 'all';
            btnModeAll.classList.add('active');
            btnModeEnv.classList.remove('active');
            fetchUnconfigured();
        });

        btnModeEnv.addEventListener('click', () => {
            currentMode = 'env';
            btnModeEnv.classList.add('active');
            btnModeAll.classList.remove('active');
            fetchUnconfigured();
        });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', fetchUnconfigured);

    // Initial load kedua data
    fetchUnconfigured();
    fetchRegistered();
});
