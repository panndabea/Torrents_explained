/* app.js — Main controller for BitTorrent Explorer SPA */

'use strict';

(function () {
  /* ── Application State ── */
  const state = {
    currentStep: 0,
    totalSteps: 7,
    file: null,           // File object
    fileData: null,       // { name, size, type, arrayBuffer }
    pieces: [],           // array of piece objects
    pieceLength: 262144,  // default 256 KiB
    hashes: [],           // array of hex strings
    hashingDone: false,
    meta: null,           // torrent metadata object
    infoHash: null,       // 40-char hex string
    sim: null,            // NetworkSimulation instance
    simRunning: false,
    flippedData: null,    // modified piece for flip demo
  };

  /* ── DOM References ── */
  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  /* ── Step Navigation ── */
  function goToStep(n) {
    if (n < 0 || n >= state.totalSteps) return;
    // Validate step requirements
    if (n >= 1 && !state.fileData) { showToast('Please select a file first'); return; }
    if (n >= 4 && state.pieces.length === 0) { showToast('Please complete Step 3 first'); return; }
    if (n >= 5 && !state.hashingDone) { showToast('Please complete hashing in Step 4 first'); return; }

    const prev = state.currentStep;
    state.currentStep = n;

    // Update step visibility
    $$('.step').forEach((el, i) => {
      el.classList.remove('active', 'exit-left', 'exit-right', 'enter-left', 'enter-right');
    });

    const prevEl = $(`step-${prev}`);
    const nextEl = $(`step-${n}`);

    if (prevEl) prevEl.classList.add(n > prev ? 'exit-left' : 'exit-right');
    if (nextEl) {
      nextEl.classList.add(n > prev ? 'enter-right' : 'enter-left');
      requestAnimationFrame(() => {
        nextEl.classList.remove('enter-right', 'enter-left');
        nextEl.classList.add('active');
      });
    }

    // Update prev/next buttons
    $('prevBtn').disabled = n === 0;
    $('nextBtn').disabled = n === state.totalSteps - 1;
    $('nextBtn').textContent = n === state.totalSteps - 2 ? 'Finish →' : 'Next →';

    UI.updateStepIndicator(n, state.totalSteps, $('stepIndicator'));
    UI.updateStepDots(n, state.totalSteps, $('stepDots'));

    // Run step-specific init
    onStepEnter(n, prev);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onStepEnter(step, prevStep) {
    if (step === 1) renderStep1();
    if (step === 2) renderStep2();
    if (step === 3) renderStep3();
    if (step === 4) renderStep4();
    if (step === 5) renderStep5();
    if (step === 6) renderStep6();
    // Stop sim when leaving step 6
    if (prevStep === 6 && state.sim) state.sim.stop();
  }

  /* ── File Input ── */
  function setupFileInput() {
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');

    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    dropZone.addEventListener('click', e => {
      if (e.target !== fileInput && !e.target.closest('label')) fileInput.click();
    });
  }

  async function handleFile(file) {
    state.file = file;
    state.hashingDone = false;
    state.hashes = [];
    state.pieces = [];
    state.meta = null;
    state.infoHash = null;

    const dropZone = $('dropZone');
    dropZone.classList.add('loading');
    dropZone.querySelector('.drop-icon').textContent = '⏳';
    dropZone.querySelector('.drop-primary').textContent = 'Reading file…';

    try {
      state.fileData = await FileProcessor.processFile(file);
      dropZone.classList.remove('loading');
      dropZone.querySelector('.drop-icon').textContent = '✅';
      dropZone.querySelector('.drop-primary').textContent = file.name;
      // Auto-advance to step 1
      setTimeout(() => goToStep(1), 400);
    } catch (err) {
      dropZone.classList.remove('loading');
      dropZone.querySelector('.drop-icon').textContent = '❌';
      dropZone.querySelector('.drop-primary').textContent = 'Error reading file';
      console.error(err);
    }
  }

  /* ── Step 1: File Overview ── */
  function renderStep1() {
    if (!state.fileData) return;
    const fd = state.fileData;
    $('fileName').textContent = fd.name;
    $('fileSize').textContent = `${fd.size.toLocaleString()} bytes  (${FileProcessor.humanSize(fd.size)})`;
    $('fileType').textContent = fd.type || 'Unknown';
    $('fileExt').textContent = FileProcessor.fileExtension(fd.name);
    $('fileBarText').textContent = fd.name;

    // Animate file bar in
    const bar = $('fileBarWhole');
    bar.style.opacity = '0';
    setTimeout(() => {
      bar.style.transition = 'opacity 0.6s ease';
      bar.style.opacity = '1';
    }, 100);
  }

  /* ── Step 2: Piece Size ── */
  function renderStep2() {
    updatePieceStats();
    // Only attach listeners once using a flag
    const sizeOptions = $('sizeOptions');
    if (!sizeOptions.dataset.bound) {
      sizeOptions.dataset.bound = '1';
      sizeOptions.addEventListener('click', function(e) {
        const btn = e.target.closest('.size-option');
        if (!btn) return;
        sizeOptions.querySelectorAll('.size-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.pieceLength = parseInt(btn.dataset.size);
        state.pieces = [];
        state.hashes = [];
        state.hashingDone = false;
        updatePieceStats();
      });
    }
  }

  function updatePieceStats() {
    if (!state.fileData) return;
    const n = Math.ceil(state.fileData.size / state.pieceLength);
    $('statPieceCount').textContent = n.toLocaleString();
    $('statPieceSize').textContent = FileProcessor.humanPieceSize(state.pieceLength);
    $('statHashSize').textContent = FileProcessor.humanSize(n * 20);
    UI.renderPiecePreview(state.fileData.size, state.pieceLength, $('pieceSizePreview'));
  }

  /* ── Step 3: Piece Visualization ── */
  function renderStep3() {
    if (!state.fileData) return;

    // Split file into pieces if needed
    if (state.pieces.length === 0) {
      state.pieces = FileProcessor.splitIntoPieces(state.fileData.arrayBuffer, state.pieceLength);
    }

    const MAX_DISPLAY = 100;
    const pieceBar = $('pieceBar');
    UI.createPieceBar(state.pieces, pieceBar, onPieceClick, MAX_DISPLAY);
    UI.animateSplitting(pieceBar);

    $('piecesCountLabel').textContent = `${state.pieces.length.toLocaleString()} piece${state.pieces.length !== 1 ? 's' : ''}`;
    if (state.pieces.length > MAX_DISPLAY) {
      $('piecesNote').textContent = `(showing first ${MAX_DISPLAY} — ${state.pieces.length - MAX_DISPLAY} more not displayed)`;
    } else {
      $('piecesNote').textContent = '';
    }

    // Close button — clone to remove any previous listeners
    const closeBtn = $('closePieceDetail');
    const freshClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(freshClose, closeBtn);
    freshClose.addEventListener('click', () => {
      $('pieceDetailPanel').style.display = 'none';
      pieceBar.querySelectorAll('.piece-block.selected').forEach(b => b.classList.remove('selected'));
    });
  }

  function onPieceClick(piece, el) {
    const panel = $('pieceDetailPanel');
    panel.style.display = 'block';
    panel.style.animation = 'none';
    requestAnimationFrame(() => { panel.style.animation = ''; });

    $('pieceDetailTitle').textContent = `Piece #${piece.index}`;
    $('pieceDetailTitle').style.borderLeft = `4px solid ${UI.getPieceColor(piece.index)}`;
    $('pieceByteRange').textContent = `${piece.start.toLocaleString()} – ${piece.end.toLocaleString()} bytes`;
    $('pieceSizeDetail').textContent = FileProcessor.humanSize(piece.size);

    const hex = FileProcessor.getHexPreview(piece.data, 32);
    const hexEl = $('pieceHexPreview');
    hexEl.innerHTML = '';
    hex.split(' ').forEach((byte, i) => {
      const span = document.createElement('span');
      span.className = 'hex-byte';
      span.textContent = byte;
      if (i % 8 === 7) span.classList.add('hex-byte-group');
      hexEl.appendChild(span);
      if ((i + 1) % 16 === 0 && i < 31) hexEl.appendChild(document.createElement('br'));
    });
  }

  /* ── Step 4: Hashing ── */
  function renderStep4() {
    if (state.hashingDone) {
      showHashResults();
      return;
    }

    const startBtn = $('startHashingBtn');
    startBtn.addEventListener('click', async function() {
      this.disabled = true;
      this.textContent = '⏳ Hashing…';

      if (state.pieces.length === 0) {
        state.pieces = FileProcessor.splitIntoPieces(state.fileData.arrayBuffer, state.pieceLength);
      }

      $('hashProgressContainer').style.display = 'flex';

      try {
        state.hashes = await Hasher.hashAllPieces(state.pieces, (done, total) => {
          const pct = Math.round((done / total) * 100);
          $('hashProgressFill').style.width = pct + '%';
          $('hashProgressLabel').textContent = `Hashing piece ${done} of ${total}… (${pct}%)`;
        });

        state.hashingDone = true;
        $('hashProgressLabel').textContent = '✅ Hashing complete!';
        this.style.display = 'none';
        setTimeout(showHashResults, 500);
      } catch (err) {
        this.disabled = false;
        this.textContent = '🔐 Start Hashing';
        console.error('Hashing error:', err);
        showToast('Hashing failed: ' + err.message);
      }
    }, { once: true });
  }

  function showHashResults() {
    if (!state.hashingDone) return;

    // Show flip demo
    const flipDemo = $('flipDemo');
    flipDemo.style.display = 'block';
    setupFlipDemo();

    // Show hash table
    const tableContainer = $('hashTableContainer');
    tableContainer.style.display = 'block';

    const MAX_TABLE = 50;
    const table = $('hashTable');
    table.innerHTML = '';

    const show = state.hashes.slice(0, MAX_TABLE);
    show.forEach((hash, i) => {
      const row = document.createElement('div');
      row.className = 'hash-row';
      row.style.setProperty('--piece-color', UI.getPieceColor(i));
      row.innerHTML = `
        <span class="hash-idx">#${i}</span>
        <code class="hash-val">${UI.formatHashDisplay(hash)}</code>
        <button class="copy-btn-sm" title="Copy hash" data-hash="${hash}">📋</button>
      `;
      table.appendChild(row);
    });

    if (state.hashes.length > MAX_TABLE) {
      const more = document.createElement('div');
      more.className = 'hash-more-row';
      more.textContent = `… and ${state.hashes.length - MAX_TABLE} more hashes (${FileProcessor.humanSize(state.hashes.length * 20)} total)`;
      table.appendChild(more);
    }

    if (state.hashes.length > MAX_TABLE) {
      $('hashTableNote').textContent = `showing first ${MAX_TABLE} of ${state.hashes.length}`;
    }

    // Copy buttons in hash table
    table.addEventListener('click', e => {
      const btn = e.target.closest('.copy-btn-sm');
      if (btn && btn.dataset.hash) copyToClipboard(btn.dataset.hash, btn);
    });
  }

  function setupFlipDemo() {
    const piece0 = state.pieces[0];
    const hash0 = state.hashes[0];

    // Show original bytes
    renderHexBytes($('originalBytes'), new Uint8Array(piece0.data, 0, 16), -1);
    renderHashChunks($('originalHash'), hash0, null, null);

    state.flippedData = null;

    // Replace button to remove any previous listeners
    const oldBtn = $('flipByteBtn');
    const newBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    newBtn.addEventListener('click', async function() {
      const result = Hasher.flipRandomByte(piece0.data);
      state.flippedData = result;
      const newHash = await Hasher.hashPiece(result.modified);

      renderHexBytes($('modifiedBytes'), new Uint8Array(result.modified, 0, 16), result.byteIndex);
      renderHashChunks($('modifiedHash'), newHash, hash0, newHash);
    });
  }

  function renderHexBytes(container, bytes, highlightIndex) {
    container.innerHTML = '';
    bytes.forEach((b, i) => {
      const span = document.createElement('span');
      span.className = 'hex-byte-demo';
      span.textContent = b.toString(16).padStart(2, '0');
      if (i === highlightIndex) {
        span.classList.add('flipped');
      }
      container.appendChild(span);
    });
  }

  function renderHashChunks(container, hash, original, modified) {
    container.innerHTML = '';
    const chunks = hash.match(/.{1,8}/g);
    chunks.forEach((chunk, i) => {
      const span = document.createElement('span');
      span.className = 'hash-chunk';
      span.textContent = chunk;

      if (original && modified && original !== modified) {
        const origChunk = original.match(/.{1,8}/g)[i];
        if (chunk !== origChunk) span.classList.add('changed');
      }
      container.appendChild(span);
      if (i < chunks.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'hash-sep';
        sep.textContent = ' ';
        container.appendChild(sep);
      }
    });
  }

  /* ── Step 5: Torrent Metadata ── */
  async function renderStep5() {
    if (!state.hashingDone) return;

    if (!state.meta) {
      state.meta = TorrentBuilder.buildTorrentMeta(state.file, state.pieces, state.hashes, state.pieceLength);
    }

    // Render human-readable tree (innerHTML replaces old content + old delegated listeners)
    const metaTree = $('metaTree');
    metaTree.innerHTML = UI.buildMetaTreeHTML(state.meta, state.hashes);

    // Delegated click: expandable nodes + copy buttons (safe to re-add on innerHTML refresh)
    metaTree.addEventListener('click', e => {
      const expandable = e.target.closest('.meta-expandable');
      if (expandable) {
        const targetId = expandable.dataset.target;
        const target = document.getElementById(targetId);
        if (target) {
          const isHidden = target.style.display === 'none';
          target.style.display = isHidden ? '' : 'none';
          expandable.textContent = expandable.textContent.replace(isHidden ? '►' : '▼', isHidden ? '▼' : '►');
        }
      }
      const copyBtn = e.target.closest('.copy-btn-sm');
      if (copyBtn && copyBtn.dataset.hash) copyToClipboard(copyBtn.dataset.hash, copyBtn);
    });

    // Bencode view
    const bencodeStr = TorrentBuilder.buildDisplayBencode(state.meta);
    $('bencodeDisplay').textContent = bencodeStr;

    // View toggle — clone buttons to avoid duplicate listeners
    ['metaHumanBtn', 'metaBencodeBtn'].forEach(id => {
      const old = $(id);
      const fresh = old.cloneNode(true);
      old.parentNode.replaceChild(fresh, old);
    });
    $('metaHumanBtn').addEventListener('click', function() {
      $('metaHumanView').classList.remove('hidden');
      $('metaBencodeView').classList.add('hidden');
      this.classList.add('active');
      $('metaBencodeBtn').classList.remove('active');
    });
    $('metaBencodeBtn').addEventListener('click', function() {
      $('metaBencodeView').classList.remove('hidden');
      $('metaHumanView').classList.add('hidden');
      this.classList.add('active');
      $('metaHumanBtn').classList.remove('active');
    });

    // Compute info-hash
    if (!state.infoHash) {
      $('infoHashValue').textContent = 'Computing…';
      try {
        state.infoHash = await TorrentBuilder.buildInfoHash(state.meta);
        $('infoHashValue').textContent = state.infoHash;
      } catch (e) {
        $('infoHashValue').textContent = 'Error computing info-hash';
      }
    } else {
      $('infoHashValue').textContent = state.infoHash;
    }

    // Clone action buttons to prevent duplicate listeners on re-entry
    ['copyInfoHash', 'downloadTorrentBtn'].forEach(id => {
      const old = $(id);
      const fresh = old.cloneNode(true);
      old.parentNode.replaceChild(fresh, old);
    });

    $('copyInfoHash').addEventListener('click', function() {
      if (state.infoHash) copyToClipboard(state.infoHash, this);
    });

    $('downloadTorrentBtn').addEventListener('click', function() {
      const blob = TorrentBuilder.generateTorrentFile(state.meta, state.infoHash);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = state.fileData.name.replace(/\.[^.]+$/, '') + '.torrent';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /* ── Step 6: Network Simulation ── */
  function renderStep6() {
    const canvas = $('simCanvas');
    const numPieces = Math.min(state.pieces.length || 12, 16);

    if (state.sim) {
      state.sim.stop();
      state.sim.reset();
    } else {
      state.sim = new NetworkSimulation(canvas, numPieces);
    }

    state.sim.onStats = ({ distributed, seeders, leechers }) => {
      $('simStatDistributed').textContent = distributed + '%';
      $('simStatSeeders').textContent = seeders;
      $('simStatLeechers').textContent = leechers;

      // Rarity bar
      const rarity = state.sim.getRarityData();
      UI.renderRarityBar(rarity, $('rarestBar'), 7);

      // Completion message
      if (distributed >= 100 && state.simRunning) {
        $('completionMessage').style.display = 'block';
        $('completionMessage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        state.simRunning = false;
      }
    };

    // Draw initial state
    state.sim._draw();
    state.sim._emitStats();

    // Clone sim control buttons to prevent duplicate listeners on re-entry
    ['simStartBtn', 'simResetBtn'].forEach(id => {
      const old = $(id);
      const fresh = old.cloneNode(true);
      old.parentNode.replaceChild(fresh, old);
    });

    $('simStartBtn').addEventListener('click', function() {
      if (state.simRunning) {
        state.sim.stop();
        state.simRunning = false;
        this.textContent = '▶ Resume';
      } else {
        $('completionMessage').style.display = 'none';
        state.sim.start();
        state.simRunning = true;
        this.textContent = '⏸ Pause';
      }
    });

    $('simResetBtn').addEventListener('click', function() {
      state.sim.stop();
      state.simRunning = false;
      $('simStartBtn').textContent = '▶ Start Simulation';
      $('completionMessage').style.display = 'none';
      state.sim.reset();
    });
  }

  /* ── Explanation Toggles ── */
  function setupExplanationToggles() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn[data-mode]');
      if (!btn) return;
      const parent = btn.closest('.explanation-toggle');
      if (!parent) return;
      parent.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const step = btn.closest('.step');
      if (!step) return;
      const mode = btn.dataset.mode;
      step.querySelectorAll('.explanation').forEach(el => {
        el.classList.toggle('hidden', !el.classList.contains(mode));
      });
    });
  }

  /* ── Utilities ── */
  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {
      // Legacy fallback for browsers without clipboard write permission
      // document.execCommand('copy') is deprecated but still widely supported as a fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy'); // eslint-disable-line no-restricted-syntax -- legacy fallback only
        ta.remove();
        btn.textContent = '✅';
        setTimeout(() => { btn.textContent = '📋'; }, 1500);
      } catch (_) {
        // Silent fail — clipboard unavailable in this context
      }
    });
  }

  function showToast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  /* ── Landing animations ── */
  function setupLandingAnimation() {
    const container = $('piecesExplosion');
    if (!container) return;
    const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ec4899','#06b6d4'];
    for (let i = 0; i < 6; i++) {
      const p = document.createElement('div');
      p.className = 'piece-particle';
      p.style.backgroundColor = colors[i];
      p.style.setProperty('--dx', (Math.cos((i / 6) * Math.PI * 2) * 60) + 'px');
      p.style.setProperty('--dy', (Math.sin((i / 6) * Math.PI * 2) * 60) + 'px');
      p.style.animationDelay = (i * 0.15) + 's';
      container.appendChild(p);
    }
  }

  /* ── Boot ── */
  function init() {
    setupFileInput();
    setupExplanationToggles();
    setupLandingAnimation();

    $('prevBtn').addEventListener('click', () => goToStep(state.currentStep - 1));
    $('nextBtn').addEventListener('click', () => goToStep(state.currentStep + 1));

    // Keyboard navigation
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToStep(state.currentStep + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToStep(state.currentStep - 1);
    });

    UI.updateStepIndicator(0, state.totalSteps, $('stepIndicator'));
    UI.updateStepDots(0, state.totalSteps, $('stepDots'));
    goToStep(0);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
