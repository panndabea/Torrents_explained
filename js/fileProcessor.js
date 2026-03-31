/* fileProcessor.js — File reading, splitting, and byte utilities */

'use strict';

const FileProcessor = (() => {

  /**
   * Read a File object into an ArrayBuffer.
   * @param {File} file
   * @returns {Promise<{name,size,type,arrayBuffer}>}
   */
  async function processFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve({
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          arrayBuffer: e.target.result
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Split an ArrayBuffer into fixed-size pieces.
   * @param {ArrayBuffer} arrayBuffer
   * @param {number} pieceLength  bytes per piece
   * @returns {Array<{index,start,end,size,data}>}
   */
  function splitIntoPieces(arrayBuffer, pieceLength) {
    const pieces = [];
    const totalBytes = arrayBuffer.byteLength;
    for (let i = 0; i < totalBytes; i += pieceLength) {
      const end = Math.min(i + pieceLength, totalBytes);
      pieces.push({
        index: pieces.length,
        start: i,
        end: end,
        size: end - i,
        data: arrayBuffer.slice(i, end)
      });
    }
    return pieces;
  }

  /**
   * Return the first numBytes of a piece's data as a hex string.
   * @param {ArrayBuffer} pieceData
   * @param {number} numBytes
   * @returns {string}
   */
  function getHexPreview(pieceData, numBytes) {
    const bytes = new Uint8Array(pieceData, 0, Math.min(numBytes, pieceData.byteLength));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  /**
   * Human-readable file size string.
   * @param {number} bytes
   * @returns {string}
   */
  function humanSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = Math.floor(Math.log2(bytes) / 10);
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  /**
   * Human-readable piece-size string.
   * @param {number} bytes
   * @returns {string}
   */
  function humanPieceSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KiB';
    return (bytes / 1048576).toFixed(0) + ' MiB';
  }

  /**
   * Return file extension (uppercased, without dot) or 'FILE'.
   * @param {string} name
   * @returns {string}
   */
  function fileExtension(name) {
    const parts = name.split('.');
    if (parts.length > 1) return parts[parts.length - 1].toUpperCase().slice(0, 4);
    return 'FILE';
  }

  return { processFile, splitIntoPieces, getHexPreview, humanSize, humanPieceSize, fileExtension };
})();
