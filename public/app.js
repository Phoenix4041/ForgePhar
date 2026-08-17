document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
});

function setupDropzone(dropzoneEl, inputEl, btnEl) {
    dropzoneEl.addEventListener('click', () => inputEl.click());

    dropzoneEl.addEventListener('dragover', e => {
        e.preventDefault();
        dropzoneEl.classList.add('dragover');
    });
    dropzoneEl.addEventListener('dragleave', () => dropzoneEl.classList.remove('dragover'));
    dropzoneEl.addEventListener('drop', e => {
        e.preventDefault();
        dropzoneEl.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            inputEl.files = e.dataTransfer.files;
            updateLabel();
        }
    });

    inputEl.addEventListener('change', updateLabel);

    function updateLabel() {
        const file = inputEl.files[0];
        if (file) {
            dropzoneEl.querySelector('.main-text').textContent = file.name;
            dropzoneEl.querySelector('.sub-text').textContent = (file.size / 1024).toFixed(1) + ' KB';
            btnEl.disabled = false;
        } else {
            btnEl.disabled = true;
        }
    }
}

document.querySelectorAll('.dropzone').forEach(dz => {
    const input = document.getElementById(dz.dataset.target);
    const btn = document.querySelector(`#panel-${dz.closest('.panel').id.split('-')[1]} button.primary`);
    setupDropzone(dz, input, btn);
});

async function callApi(action, formData, resultEl, btnEl) {
    btnEl.disabled = true;
    const originalText = btnEl.textContent;
    btnEl.innerHTML = '<span class="spinner"></span> Procesando...';
    resultEl.classList.remove('show', 'error');

    try {
        const res = await fetch(`api.php?action=${action}`, { method: 'POST', body: formData });
        const data = await res.json();

        if (!data.ok) {
            resultEl.classList.add('show', 'error');
            resultEl.innerHTML = `<div class="title">Error</div><div class="meta">${escapeHtml(data.error)}</div>`;
            return;
        }

        let html = `<div class="title">Listo: ${escapeHtml(data.filename)}</div>`;
        html += `<div class="meta">Tamaño: ${data.size}</div>`;
        if (data.protected) {
            html += `<div class="meta">Compresión GZIP + comentarios eliminados</div>`;
        }
        html += `<a class="download-btn" href="api.php?action=download&token=${data.token}">Descargar</a>`;
        if (data.tree && data.tree.length) {
            html += `<div class="tree">${data.tree.map(escapeHtml).join('<br>')}</div>`;
        }
        resultEl.innerHTML = html;
        resultEl.classList.add('show');
    } catch (err) {
        resultEl.classList.add('show', 'error');
        resultEl.innerHTML = `<div class="title">Error de conexión</div><div class="meta">${escapeHtml(err.message)}</div>`;
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = originalText;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.getElementById('extract-btn').addEventListener('click', () => {
    const file = document.getElementById('extract-file').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    callApi('extract', fd, document.getElementById('extract-result'), document.getElementById('extract-btn'));
});

document.getElementById('build-btn').addEventListener('click', () => {
    const file = document.getElementById('build-file').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('pluginName', document.getElementById('build-name').value);
    fd.append('version', document.getElementById('build-version').value);
    callApi('build', fd, document.getElementById('build-result'), document.getElementById('build-btn'));
});

document.getElementById('protect-btn').addEventListener('click', () => {
    const file = document.getElementById('protect-file').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('pluginName', document.getElementById('protect-name').value);
    fd.append('version', document.getElementById('protect-version').value);
    callApi('protect', fd, document.getElementById('protect-result'), document.getElementById('protect-btn'));
});
