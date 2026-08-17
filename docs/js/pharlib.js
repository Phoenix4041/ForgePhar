(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.pharlib = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(buf) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const GLOBAL_GZ = 0x00001000;
    const GLOBAL_SIGNATURE = 0x00010000;
    const ENT_GZ = 0x00001000;
    const ENT_BZ2 = 0x00002000;
    const ENT_COMPRESSION_MASK = ENT_GZ | ENT_BZ2;
    const DEFAULT_STUB = "<?php __HALT_COMPILER(); ?>\r\n";

    class Reader {
        constructor(buf) {
            this.buf = buf;
            this.pos = 0;
            this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
        u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
        bytes(n) { const v = this.buf.slice(this.pos, this.pos + n); this.pos += n; return v; }
        str(n) { return new TextDecoder().decode(this.bytes(n)); }
    }

    function findHaltCompiler(buf) {
        const needle = new TextEncoder().encode('__HALT_COMPILER();');
        outer:
        for (let i = 0; i <= buf.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) {
                if (buf[i + j] !== needle[j]) continue outer;
            }
            let end = i + needle.length;
            let j = end;
            while (buf[j] === 0x20 || buf[j] === 0x09) j++;
            if (buf[j] === 0x3f && buf[j + 1] === 0x3e) end = j + 2;
            if (buf[end] === 0x0d) end++;
            if (buf[end] === 0x0a) end++;
            return end;
        }
        throw new Error('__HALT_COMPILER(); no encontrado: no es un .phar valido');
    }

    let _pako = null;
    function setPako(pako) { _pako = pako; }
    function pakoInflate(data) { return _pako.inflateRaw(data); }
    function pakoDeflate(data) { return _pako.deflateRaw(data, { level: 9 }); }

    let _sha1 = null;
    function setSha1(fn) { _sha1 = fn; }

    function readPhar(buf) {
        const stubEnd = findHaltCompiler(buf);
        const stub = new TextDecoder().decode(buf.slice(0, stubEnd));

        const r = new Reader(buf.slice(stubEnd));
        const manifestLen = r.u32();
        const manifestStart = r.pos;
        const numFiles = r.u32();
        r.u16();
        const globalFlags = r.u32();
        const aliasLen = r.u32();
        const alias = r.str(aliasLen);
        const metaLen = r.u32();
        r.bytes(metaLen);

        const entries = [];
        for (let i = 0; i < numFiles; i++) {
            const nameLen = r.u32();
            const name = r.str(nameLen);
            const uncompressedSize = r.u32();
            const timestamp = r.u32();
            const compressedSize = r.u32();
            const crc = r.u32();
            const flags = r.u32();
            const fMetaLen = r.u32();
            r.bytes(fMetaLen);
            entries.push({ name, uncompressedSize, timestamp, compressedSize, crc, flags });
        }

        if (r.pos - manifestStart !== manifestLen) {
            throw new Error(`manifest corrupto: esperado ${manifestLen}, leido ${r.pos - manifestStart}`);
        }

        let offset = stubEnd + 4 + manifestLen;
        const files = [];
        for (const e of entries) {
            const raw = buf.slice(offset, offset + e.compressedSize);
            offset += e.compressedSize;
            let content = raw;
            const comp = e.flags & ENT_COMPRESSION_MASK;
            if (comp === ENT_GZ) {
                content = pakoInflate(raw);
            } else if (comp === ENT_BZ2) {
                throw new Error('Compresion BZ2 no soportada');
            }
            files.push({ name: e.name, content, timestamp: e.timestamp });
        }

        return { stub, alias, globalFlags, files };
    }

    function u32le(n) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, n, true);
        return b;
    }
    function u16le(n) {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setUint16(0, n, true);
        return b;
    }
    function concat(arrays) {
        let total = 0;
        for (const a of arrays) total += a.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const a of arrays) { out.set(a, off); off += a.length; }
        return out;
    }

    async function writePhar({ files, alias = '', stub = DEFAULT_STUB, compress = false, timestamp = Math.floor(Date.now() / 1000) }) {
        const enc = new TextEncoder();
        const stubBytes = enc.encode(stub);

        const globalFlags = (compress ? GLOBAL_GZ : 0) | GLOBAL_SIGNATURE;
        const aliasBytes = enc.encode(alias);

        const fileHeaders = [];
        const fileContents = [];

        for (const f of files) {
            const nameBytes = enc.encode(f.name);
            const uncompressed = f.content;
            const crc = crc32(uncompressed);
            let stored = uncompressed;
            let flags = 0;
            if (compress) {
                stored = pakoDeflate(uncompressed);
                flags = ENT_GZ;
            }
            fileHeaders.push(concat([
                u32le(nameBytes.length), nameBytes,
                u32le(uncompressed.length),
                u32le(f.timestamp || timestamp),
                u32le(stored.length),
                u32le(crc),
                u32le(flags),
                u32le(0),
            ]));
            fileContents.push(stored);
        }

        const manifestBody = concat([
            u32le(files.length),
            u16le(0x0011),
            u32le(globalFlags),
            u32le(aliasBytes.length), aliasBytes,
            u32le(0),
            ...fileHeaders,
        ]);

        const manifest = concat([u32le(manifestBody.length), manifestBody]);
        const body = concat([stubBytes, manifest, ...fileContents]);

        const sigType = u32le(0x02);
        const magic = enc.encode('GBMB');
        const hash = await _sha1(body);
        return concat([body, hash, sigType, magic]);
    }

    function stripPhpComments(source) {
        let out = '';
        let i = 0;
        const n = source.length;
        let lastWasSpace = false;

        function push(ch) {
            if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
                if (lastWasSpace) return;
                out += ' ';
                lastWasSpace = true;
            } else {
                out += ch;
                lastWasSpace = false;
            }
        }
        function pushRaw(s) {
            out += s;
            lastWasSpace = false;
        }

        while (i < n) {
            const ch = source[i];
            const next = source[i + 1];

            if (ch === "'" || ch === '"') {
                const quote = ch;
                let j = i;
                pushRaw(ch);
                j++;
                while (j < n) {
                    if (source[j] === '\\' && j + 1 < n) {
                        pushRaw(source[j] + source[j + 1]);
                        j += 2;
                        continue;
                    }
                    if (source[j] === quote) {
                        pushRaw(source[j]);
                        j++;
                        break;
                    }
                    pushRaw(source[j]);
                    j++;
                }
                i = j;
                continue;
            }

            if (ch === '<' && source.slice(i, i + 3) === '<<<') {
                let j = i + 3;
                while (source[j] === ' ' || source[j] === '\t') j++;
                let nowdoc = false;
                if (source[j] === "'") { nowdoc = true; j++; }
                else if (source[j] === '"') { j++; }
                let idStart = j;
                while (/[A-Za-z0-9_]/.test(source[j])) j++;
                const id = source.slice(idStart, j);
                if (source[j] === "'" || source[j] === '"') j++;
                pushRaw(source.slice(i, j));
                const endRe = new RegExp('^[\\r\\n]+' + id + '(?![A-Za-z0-9_])', 'm');
                const rest = source.slice(j);
                const m = rest.match(new RegExp('[\\r\\n]+' + id + '\\b'));
                if (m) {
                    const endIdx = j + m.index + m[0].length;
                    pushRaw(source.slice(j, endIdx));
                    i = endIdx;
                } else {
                    pushRaw(rest);
                    i = n;
                }
                continue;
            }

            if (ch === '/' && next === '/') {
                let j = i + 2;
                while (j < n && source[j] !== '\n') j++;
                i = j;
                continue;
            }
            if (ch === '#' && next !== '[') {
                let j = i + 1;
                while (j < n && source[j] !== '\n') j++;
                i = j;
                continue;
            }
            if (ch === '/' && next === '*') {
                let j = i + 2;
                while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
                i = j + 2;
                continue;
            }

            push(ch);
            i++;
        }

        return out;
    }

    return { readPhar, writePhar, setPako, setSha1, crc32, stripPhpComments, DEFAULT_STUB };
});
