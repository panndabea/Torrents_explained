/* torrentBuilder.js — Torrent metadata and bencode */

'use strict';

const TorrentBuilder = (() => {

  /**
   * Build a human-readable metadata object describing the torrent.
   * @param {File} file
   * @param {Array} pieces
   * @param {string[]} hashes
   * @param {number} pieceLength
   * @returns {object}
   */
  function buildTorrentMeta(file, pieces, hashes, pieceLength) {
    return {
      announce: 'udp://tracker.opentrackr.org:1337/announce',
      'created by': 'BitTorrent Explorer (educational)',
      'creation date': Math.floor(Date.now() / 1000),
      encoding: 'UTF-8',
      info: {
        name: file.name,
        length: file.size,
        'piece length': pieceLength,
        pieces: hashes, // array of 40-char hex strings for display
        '_piece_count': pieces.length
      }
    };
  }

  /**
   * Compute the info-hash: SHA-1 of the bencoded info dictionary.
   * We encode piece hashes as their raw 20-byte binary representation.
   * @param {object} meta
   * @returns {Promise<string>} 40-char hex info-hash
   */
  async function buildInfoHash(meta) {
    // Build a canonical info dict for hashing
    const info = meta.info;
    // Concatenate raw 20-byte hashes
    const rawPieces = info.pieces.map(h => {
      const bytes = [];
      for (let i = 0; i < h.length; i += 2) {
        bytes.push(parseInt(h.slice(i, i + 2), 16));
      }
      return bytes;
    }).flat();

    const bencoded = bencodeInfo({
      length: info.length,
      name: info.name,
      'piece length': info['piece length'],
      pieces: rawPieces  // will be encoded as raw bytes
    });

    const enc = new TextEncoder();
    const buf = enc.encode(bencoded);
    return Hasher.hashBuffer(buf.buffer);
  }

  /**
   * Bencode an info dict where `pieces` is an array of raw bytes.
   * @param {object} info
   * @returns {string}
   */
  function bencodeInfo(info) {
    const keys = Object.keys(info).sort();
    let out = 'd';
    for (const k of keys) {
      out += `${k.length}:${k}`;
      if (k === 'pieces') {
        const bytes = info[k];
        out += `${bytes.length}:${bytes.map(b => String.fromCharCode(b)).join('')}`;
      } else {
        out += bencodeValue(info[k]);
      }
    }
    out += 'e';
    return out;
  }

  /**
   * Simple bencode encoder for display purposes (hashes shown as hex).
   * @param {*} val
   * @returns {string}
   */
  function bencode(val) {
    return bencodeValue(val);
  }

  function bencodeValue(val) {
    if (typeof val === 'number' && Number.isInteger(val)) return `i${val}e`;
    if (typeof val === 'string') return `${val.length}:${val}`;
    if (Array.isArray(val)) return `l${val.map(bencodeValue).join('')}e`;
    if (val !== null && typeof val === 'object') {
      const keys = Object.keys(val).filter(k => !k.startsWith('_')).sort();
      return `d${keys.map(k => bencodeValue(k) + bencodeValue(val[k])).join('')}e`;
    }
    return `${String(val).length}:${String(val)}`;
  }

  /**
   * Build a displayable bencode string of the full torrent meta.
   * Pieces are shown as "<N × 20 bytes>" for brevity.
   * @param {object} meta
   * @returns {string}
   */
  function buildDisplayBencode(meta) {
    const displayMeta = JSON.parse(JSON.stringify(meta));
    const count = displayMeta.info.pieces.length;
    displayMeta.info.pieces = `<${count} × 20 bytes = ${count * 20} bytes>`;
    delete displayMeta.info._piece_count;
    return bencodeValue(displayMeta);
  }

  /**
   * Generate a proper .torrent Blob for download.
   * @param {object} meta
   * @param {string} infoHash
   * @returns {Blob}
   */
  function generateTorrentFile(meta, infoHash) {
    // Simplified bencode for the .torrent file — pieces as hex strings for compatibility
    const text = buildDisplayBencode(meta);
    return new Blob([text], { type: 'application/x-bittorrent' });
  }

  /**
   * Format bencode string with syntax highlighting markers.
   * Returns an array of {type, text} tokens.
   * @param {string} bencoded
   * @returns {Array<{type:string,text:string}>}
   */
  function tokenizeBencode(bencoded) {
    const tokens = [];
    let i = 0;
    function peek() { return bencoded[i]; }
    function consume() { return bencoded[i++]; }

    function parseValue() {
      const ch = peek();
      if (ch === 'i') {
        consume(); // i
        let num = '';
        while (peek() !== 'e') num += consume();
        consume(); // e
        tokens.push({ type: 'number', text: num });
      } else if (ch === 'l') {
        consume();
        tokens.push({ type: 'bracket', text: '[' });
        while (peek() !== 'e') parseValue();
        consume();
        tokens.push({ type: 'bracket', text: ']' });
      } else if (ch === 'd') {
        consume();
        tokens.push({ type: 'bracket', text: '{' });
        while (peek() !== 'e') {
          parseValue(); // key
          tokens.push({ type: 'colon', text: ': ' });
          parseValue(); // val
        }
        consume();
        tokens.push({ type: 'bracket', text: '}' });
      } else if (ch >= '0' && ch <= '9') {
        let len = '';
        while (peek() !== ':') len += consume();
        consume(); // :
        const str = bencoded.slice(i, i + parseInt(len));
        i += parseInt(len);
        tokens.push({ type: 'string', text: `"${str}"` });
      } else {
        tokens.push({ type: 'unknown', text: consume() });
      }
    }

    try { parseValue(); } catch(e) { /* partial parse OK */ }
    return tokens;
  }

  return {
    buildTorrentMeta,
    buildInfoHash,
    bencode,
    buildDisplayBencode,
    generateTorrentFile,
    tokenizeBencode
  };
})();
