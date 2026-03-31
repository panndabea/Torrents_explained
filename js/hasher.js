/* hasher.js — SHA-1 hashing via SubtleCrypto */

'use strict';

const Hasher = (() => {

  /**
   * Hash a single piece's data with SHA-1.
   * @param {ArrayBuffer} pieceData
   * @returns {Promise<string>} hex string
   */
  async function hashPiece(pieceData) {
    const buffer = pieceData instanceof ArrayBuffer ? pieceData : pieceData.buffer;
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Hash all pieces, calling progressCallback(done, total) after each.
   * Processes in async batches to keep the UI responsive.
   * @param {Array<{data:ArrayBuffer}>} pieces
   * @param {function(number,number):void} progressCallback
   * @returns {Promise<string[]>} array of hex hashes
   */
  async function hashAllPieces(pieces, progressCallback) {
    const hashes = [];
    const BATCH = 10; // pieces per microtask batch
    for (let i = 0; i < pieces.length; i++) {
      hashes.push(await hashPiece(pieces[i].data));
      if (progressCallback) progressCallback(i + 1, pieces.length);
      // Yield to browser every BATCH pieces
      if ((i + 1) % BATCH === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return hashes;
  }

  /**
   * Hash an arbitrary ArrayBuffer with SHA-1.
   * @param {ArrayBuffer} buffer
   * @returns {Promise<string>} hex string
   */
  async function hashBuffer(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Format a 40-char hex hash into 8-char groups for readability.
   * @param {string} hash
   * @returns {string}
   */
  function formatHash(hash) {
    if (!hash || hash.length === 0) return '';
    return (hash.match(/.{1,8}/g) || [hash]).join(' ');
  }

  const MAX_FLIP_BYTE_RANGE = 32; // flip only within first 32 bytes so the hex preview shows the change

  /**
   * Return a copy of a piece's data with one random byte flipped.
   * @param {ArrayBuffer} pieceData
   * @returns {{modified:ArrayBuffer, byteIndex:number, original:number, flipped:number}}
   */
  function flipRandomByte(pieceData) {
    const copy = pieceData.slice(0);
    const view = new Uint8Array(copy);
    const byteIndex = Math.floor(Math.random() * Math.min(view.length, MAX_FLIP_BYTE_RANGE));
    const original = view[byteIndex];
    view[byteIndex] = original ^ (1 << Math.floor(Math.random() * 8));
    return { modified: copy, byteIndex, original, flipped: view[byteIndex] };
  }

  return { hashPiece, hashAllPieces, hashBuffer, formatHash, flipRandomByte };
})();
