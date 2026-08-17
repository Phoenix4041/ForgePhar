pharlib.setPako(pako);
pharlib.setSha1(async (data) => {
    const digest = await crypto.subtle.digest('SHA-1', data);
    return new Uint8Array(digest);
});

const helpModal = document.getElementById('help-modal');
const helpBtn = document.getElementById('help-btn');
const helpClose = document.getElementById('help-close');

function openHelp() {
    helpModal.classList.add('show');
}
function closeHelp() {
    helpModal.classList.remove('show');
}

helpBtn.addEventListener('click', openHelp);
helpClose.addEventListener('click', closeHelp);
helpModal.addEventListener('click', e => {
    if (e.target === helpModal) closeHelp();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && helpModal.classList.contains('show')) closeHelp();
});

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

function humanSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return Math.round(size * 100) / 100 + ' ' + units[i];
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function readFileAsBytes(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function showResult(resultEl, { filename, size, blob, protectedBuild, tree }) {
    let html = `<div class="title">Listo: ${escapeHtml(filename)}</div>`;
    html += `<div class="meta">Tamano: ${size}</div>`;
    if (protectedBuild) {
        html += `<div class="meta">Compresion GZIP + comentarios eliminados</div>`;
    }
    html += `<a class="download-btn" href="#" data-action="download">Descargar</a>`;
    if (tree && tree.length) {
        html += `<div class="tree">${tree.map(escapeHtml).join('<br>')}</div>`;
    }
    resultEl.innerHTML = html;
    resultEl.classList.add('show');
    resultEl.classList.remove('error');
    resultEl.querySelector('[data-action=download]').addEventListener('click', e => {
        e.preventDefault();
        triggerDownload(blob, filename);
    });
}

function showError(resultEl, message) {
    resultEl.innerHTML = `<div class="title">Error</div><div class="meta">${escapeHtml(message)}</div>`;
    resultEl.classList.add('show', 'error');
}

async function withBusy(btnEl, fn) {
    const original = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="spinner"></span> Procesando...';
    try {
        await fn();
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = original;
    }
}

async function zipFromFiles(files) {
    const zip = new JSZip();
    for (const f of files) {
        zip.file(f.name, f.content);
    }
    return zip.generateAsync({ type: 'uint8array' });
}

async function filesFromZip(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const files = [];
    const names = Object.keys(zip.files).sort();
    for (const name of names) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        const content = await entry.async('uint8array');
        files.push({ name, content, timestamp: entry.date ? Math.floor(entry.date.getTime() / 1000) : undefined });
    }
    return files;
}

function resolveRoot(files) {
    const topLevelDirs = new Set();
    let hasTopLevelFile = false;
    for (const f of files) {
        const slash = f.name.indexOf('/');
        if (slash === -1) {
            hasTopLevelFile = true;
        } else {
            topLevelDirs.add(f.name.slice(0, slash));
        }
    }
    if (!hasTopLevelFile && topLevelDirs.size === 1) {
        const prefix = [...topLevelDirs][0] + '/';
        return files
            .filter(f => f.name.startsWith(prefix))
            .map(f => ({ ...f, name: f.name.slice(prefix.length) }));
    }
    return files;
}

function findPluginName(files) {
    const pluginYml = files.find(f => f.name === 'plugin.yml');
    if (!pluginYml) return null;
    const text = new TextDecoder().decode(pluginYml.content);
    const m = text.match(/^name:\s*(.+)$/mi);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

document.getElementById('extract-btn').addEventListener('click', () => {
    const btn = document.getElementById('extract-btn');
    const resultEl = document.getElementById('extract-result');
    withBusy(btn, async () => {
        const file = document.getElementById('extract-file').files[0];
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        const bytes = await readFileAsBytes(file);

        let files;
        if (ext === 'phar') {
            const parsed = pharlib.readPhar(bytes);
            files = parsed.files;
        } else if (ext === 'zip') {
            files = await filesFromZip(bytes);
        } else {
            showError(resultEl, 'Formato no soportado. Usa .phar o .zip');
            return;
        }

        const zipBytes = await zipFromFiles(files);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const filename = baseName + '_extraido.zip';
        const blob = new Blob([zipBytes], { type: 'application/zip' });
        const tree = files.map(f => f.name).sort();

        showResult(resultEl, { filename, size: humanSize(blob.size), blob, tree });
    }).catch(err => showError(resultEl, err.message));
});

async function buildFromZip(file, pluginName, version, protect) {
    const bytes = await readFileAsBytes(file);
    let files = await filesFromZip(bytes);
    files = resolveRoot(files);

    if (!files.some(f => f.name === 'plugin.yml')) {
        throw new Error('No se encontro plugin.yml en el zip subido.');
    }

    const name = (pluginName || findPluginName(files) || 'Plugin').replace(/[^A-Za-z0-9_-]/g, '') || 'Plugin';

    if (protect) {
        files = files.map(f => {
            if (f.name.endsWith('.php')) {
                const stripped = pharlib.stripPhpComments(new TextDecoder().decode(f.content));
                return { ...f, content: new TextEncoder().encode(stripped) };
            }
            return f;
        });
    }

    const stub = `<?php echo 'PocketMine-MP plugin ${name} v${version}\\nThis file must not be used as a PHP script.\\n'; __HALT_COMPILER(); ?>\r\n`;
    const pharBytes = await pharlib.writePhar({ files, stub, compress: protect });

    return { filename: name + '.phar', blob: new Blob([pharBytes], { type: 'application/octet-stream' }) };
}

document.getElementById('build-btn').addEventListener('click', () => {
    const btn = document.getElementById('build-btn');
    const resultEl = document.getElementById('build-result');
    withBusy(btn, async () => {
        const file = document.getElementById('build-file').files[0];
        if (!file) return;
        const pluginName = document.getElementById('build-name').value.trim();
        const version = document.getElementById('build-version').value.trim() || '1.0.0';

        const { filename, blob } = await buildFromZip(file, pluginName, version, false);
        showResult(resultEl, { filename, size: humanSize(blob.size), blob });
    }).catch(err => showError(resultEl, err.message));
});

document.getElementById('protect-btn').addEventListener('click', () => {
    const btn = document.getElementById('protect-btn');
    const resultEl = document.getElementById('protect-result');
    withBusy(btn, async () => {
        const file = document.getElementById('protect-file').files[0];
        if (!file) return;
        const pluginName = document.getElementById('protect-name').value.trim();
        const version = document.getElementById('protect-version').value.trim() || '1.0.0';

        const { filename, blob } = await buildFromZip(file, pluginName, version, true);
        showResult(resultEl, { filename, size: humanSize(blob.size), blob, protectedBuild: true });
    }).catch(err => showError(resultEl, err.message));
});
