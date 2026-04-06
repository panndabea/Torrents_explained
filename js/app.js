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
    milestones: {
      fileLoaded: false,
      piecesCreated: false,
      hashesComputed: false,
      metadataAssembled: false,
      swarmSimulated: false
    }
  };

  /* ── DOM References ── */
  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);
  const CONTINUITY_MIN_PIECES = 8;
  const CONTINUITY_MAX_PIECES = 32;
  const CONTINUITY_EMPTY_COLOR = '#334155';

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

    if (prevEl && prevEl !== nextEl) prevEl.classList.add(n > prev ? 'exit-left' : 'exit-right');
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
    applyFocusMode(n);
    updateLearningProgress();
    updateContinuityRail();

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
      state.milestones.fileLoaded = true;
      dropZone.classList.remove('loading');
      dropZone.querySelector('.drop-icon').textContent = '✅';
      dropZone.querySelector('.drop-primary').textContent = file.name;
      showToast(`✅ File loaded: ${FileProcessor.humanSize(file.size)}`, 'success');
      updateLearningProgress();
      updateContinuityRail();
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
    setupPieceCountPredict();
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
    // Reset predict widget on size change
    const predictEl = $('predictPieces');
    if (predictEl) {
      const resultEl = $('pieceGuessResult');
      if (resultEl) resultEl.classList.add('hidden');
      const guessInput = $('pieceCountGuess');
      if (guessInput) guessInput.value = '';
    }
  }

  /* ── Step 3: Piece Visualization ── */
  function renderStep3() {
    if (!state.fileData) return;

    // Split file into pieces if needed
    if (state.pieces.length === 0) {
      state.pieces = FileProcessor.splitIntoPieces(state.fileData.arrayBuffer, state.pieceLength);
      state.milestones.piecesCreated = true;
      updateLearningProgress();
      updateContinuityRail();
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

    setupHashPredict();

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
        state.milestones.hashesComputed = true;
        updateLearningProgress();
        updateContinuityRail();
        $('hashProgressLabel').textContent = '✅ Hashing complete!';
        this.style.display = 'none';
        showToast(`🔐 Nice — ${state.hashes.length.toLocaleString()} piece hash${state.hashes.length !== 1 ? 'es' : ''} computed!`, 'success');
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

    // Show error simulation
    const errorSim = $('errorSim');
    if (errorSim) errorSim.style.display = 'block';
    setupErrorSim();

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
        <code class="hash-val short" data-full-hash="${hash}" data-state="short">${UI.shortHashDisplay(hash)}</code>
        <button class="copy-btn-sm hash-toggle-btn" title="Expand hash" data-hash="${hash}">↕</button>
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
      const toggleBtn = e.target.closest('.hash-toggle-btn');
      if (toggleBtn) {
        const code = toggleBtn.parentElement.querySelector('.hash-val');
        if (code) toggleHashDisplay(code, toggleBtn);
      }
      const btn = e.target.closest('.copy-btn-sm');
      if (btn && btn.dataset.hash && !btn.classList.contains('hash-toggle-btn')) copyToClipboard(btn.dataset.hash, btn);
    });
  }

  function setupFlipDemo() {
    const piece0 = state.pieces[0];
    const hash0 = state.hashes[0];

    // Show original bytes
    renderHexBytes($('originalBytes'), new Uint8Array(piece0.data, 0, 16), -1);
    renderHashChunks($('originalHash'), hash0, null, null);

    state.flippedData = null;

    async function doFlip(result) {
      state.flippedData = result;
      const newHash = await Hasher.hashPiece(result.modified);

      renderHexBytes($('modifiedBytes'), new Uint8Array(result.modified, 0, 16), result.byteIndex);
      renderHashChunks($('modifiedHash'), newHash, hash0, newHash);

      // Show byte info
      const infoEl = $('flipByteInfo');
      if (infoEl) {
        infoEl.classList.remove('hidden');
        $('flipInfoPos').textContent = result.byteIndex;
        $('flipInfoOld').textContent = result.original.toString(16).padStart(2,'0');
        $('flipInfoNew').textContent = result.flipped.toString(16).padStart(2,'0');
      }
      // Show badge
      const badge = $('flipBadge');
      if (badge) badge.style.display = '';

      // Count changed hash chars and show summary
      const changed = [...hash0].filter((c, i) => c !== newHash[i]).length;
      const summaryEl = $('hashDiffSummary');
      if (summaryEl) {
        summaryEl.classList.remove('hidden');
        summaryEl.innerHTML = `<strong>${changed}/40 hash characters changed</strong> (${Math.round(changed/40*100)}%) — that's the avalanche effect in action!`;
      }
    }

    // Clone specific-byte button
    const oldBtn = $('flipByteBtn');
    if (oldBtn) {
      const newBtn = oldBtn.cloneNode(true);
      oldBtn.parentNode.replaceChild(newBtn, oldBtn);
      // Set max dynamically based on displayed range (first 32 bytes shown in hex preview)
      const maxIdx = Math.min(31, new Uint8Array(piece0.data).length - 1);
      const idxInput = $('flipByteIndex');
      if (idxInput) idxInput.max = maxIdx;
      newBtn.addEventListener('click', async function() {
        const idx = parseInt($('flipByteIndex').value) || 0;
        const result = Hasher.flipSpecificByte(piece0.data, idx);
        await doFlip(result);
      });
    }

    // Clone random button
    const oldRnd = $('flipRandomBtn');
    if (oldRnd) {
      const newRnd = oldRnd.cloneNode(true);
      oldRnd.parentNode.replaceChild(newRnd, oldRnd);
      newRnd.addEventListener('click', async function() {
        const result = Hasher.flipRandomByte(piece0.data);
        if ($('flipByteIndex')) $('flipByteIndex').value = result.byteIndex;
        await doFlip(result);
      });
    }
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
      state.milestones.metadataAssembled = true;
      updateLearningProgress();
      updateContinuityRail();
    }

    setupMetaPredict();

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
      const toggleBtn = e.target.closest('.hash-toggle-btn');
      if (toggleBtn) {
        const code = toggleBtn.parentElement.querySelector('.hash-code');
        if (code) toggleHashDisplay(code, toggleBtn);
      }
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
    applyStepModeConstraints($('step-5'), getActiveMode($('step-5')));

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
        state.simRunning = false;
        state.milestones.swarmSimulated = true;
        updateLearningProgress();
        updateContinuityRail();
        // Show recap + quiz
        const recap = $('recapSection');
        if (recap) {
          recap.classList.remove('hidden');
          setTimeout(() => recap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
        }
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

    // Setup quiz
    setupRecapQuiz();
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
      applyStepModeConstraints(step, mode);
    });
  }

  function getActiveMode(stepEl) {
    // Every step has an .explanation-toggle with one active .toggle-btn carrying data-mode.
    const activeModeButton = stepEl?.querySelector('.explanation-toggle .toggle-btn.active[data-mode]');
    return activeModeButton?.dataset.mode || 'simple';
  }

  function applyStepModeConstraints(stepEl, mode) {
    if (!stepEl || stepEl.id !== 'step-5') return;
    const bencodeBtn = $('metaBencodeBtn');
    const humanBtn = $('metaHumanBtn');
    const humanView = $('metaHumanView');
    const bencodeView = $('metaBencodeView');
    if (!bencodeBtn || !humanBtn || !humanView || !bencodeView) return;

    const hideBencode = mode === 'simple';
    bencodeBtn.classList.toggle('hidden', hideBencode);
    if (hideBencode) {
      bencodeView.classList.add('hidden');
      humanView.classList.remove('hidden');
      bencodeBtn.classList.remove('active');
      humanBtn.classList.add('active');
    }
  }

  /* ── Predict → Reveal: Step 2 piece count ── */
  function setupPieceCountPredict() {
    const container = $('predictPieces');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = '1';
    $('submitPieceGuess').addEventListener('click', function() {
      const guess = parseInt($('pieceCountGuess').value);
      if (isNaN(guess) || guess < 1) { showToast('Please enter a positive number'); return; }
      const actual = Math.ceil(state.fileData.size / state.pieceLength);
      const diff = Math.abs(guess - actual);
      const pct = Math.round((diff / actual) * 100);
      const resultEl = $('pieceGuessResult');
      resultEl.classList.remove('hidden', 'correct', 'incorrect');
      if (guess === actual) {
        resultEl.className = 'predict-reveal-result correct';
        resultEl.innerHTML = `✅ Exactly right! The file splits into <strong>${actual.toLocaleString()} pieces</strong>. Nice mental model!`;
        showToast('🎉 Exactly right!', 'success');
      } else if (pct <= 20) {
        resultEl.className = 'predict-reveal-result correct';
        resultEl.innerHTML = `👍 Very close! Actual answer: <strong>${actual.toLocaleString()} pieces</strong>. You were off by ${diff.toLocaleString()} (${pct}%).`;
      } else {
        resultEl.className = 'predict-reveal-result incorrect';
        resultEl.innerHTML = `The actual answer is <strong>${actual.toLocaleString()} pieces</strong> (${FileProcessor.humanSize(state.fileData.size)} ÷ ${FileProcessor.humanPieceSize(state.pieceLength)}). Your guess was ${diff.toLocaleString()} ${guess < actual ? 'too low' : 'too high'}.`;
      }
    });
  }

  /* ── Predict → Reveal: Step 4 hash avalanche ── */
  function setupHashPredict() {
    const container = $('predictHash');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = '1';
    container.querySelectorAll('.predict-choice').forEach(btn => {
      btn.addEventListener('click', function() {
        container.querySelectorAll('.predict-choice').forEach(b => {
          b.classList.remove('correct-ans', 'wrong-ans');
        });
        const isCorrect = this.dataset.answer === 'correct';
        this.classList.add(isCorrect ? 'correct-ans' : 'wrong-ans');
        // Mark the correct one too
        container.querySelector('[data-answer="correct"]').classList.add('correct-ans');
        const resultEl = $('hashPredictResult');
        resultEl.classList.remove('hidden', 'correct', 'incorrect');
        if (isCorrect) {
          resultEl.className = 'predict-reveal-result correct';
          resultEl.innerHTML = `✅ Correct! The avalanche effect means even a 1-bit change flips ~50% of the hash bits — typically almost all 40 hex characters change. This is what makes SHA-1 a reliable integrity check.`;
          showToast('🎉 Correct! That\'s the avalanche effect.', 'success');
        } else {
          resultEl.className = 'predict-reveal-result incorrect';
          resultEl.innerHTML = `The correct answer is <strong>"Almost all of them"</strong>. The avalanche effect means a single-bit input change statistically flips ~50% of output bits. Try the demo below to see it live!`;
        }
      });
    });
  }

  /* ── Predict → Reveal: Step 5 metadata content ── */
  function setupMetaPredict() {
    const container = $('predictMeta');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = 'true';
    container.querySelectorAll('.predict-choice').forEach(btn => {
      btn.addEventListener('click', function() {
        container.querySelectorAll('.predict-choice').forEach(b => {
          b.classList.remove('correct-ans', 'wrong-ans');
        });
        const isCorrect = this.dataset.answer === 'correct';
        this.classList.add(isCorrect ? 'correct-ans' : 'wrong-ans');
        container.querySelector('[data-answer="correct"]').classList.add('correct-ans');
        const resultEl = $('metaPredictResult');
        resultEl.classList.remove('hidden', 'correct', 'incorrect');
        if (isCorrect) {
          resultEl.className = 'predict-reveal-result correct';
          resultEl.innerHTML = '✅ Correct. A torrent is a recipe: file details, piece size, and piece hashes.';
          showToast('Nice — you nailed what a .torrent contains.', 'success');
        } else {
          resultEl.className = 'predict-reveal-result incorrect';
          resultEl.innerHTML = 'The right answer is <strong>metadata + hashes</strong>. The actual bytes are fetched from peers.';
        }
      });
    });
  }

  function applyFocusMode(step) {
    const stepEl = $(`step-${step}`);
    if (!stepEl) return;
    document.body.classList.add('focus-mode');
    stepEl.querySelectorAll('.focus-target').forEach(el => el.classList.remove('focus-target'));
    const selectors = {
      1: ['.file-overview-card'],
      2: ['.piece-size-selector', '#predictPieces'],
      3: ['#piecesViz', '.piece-bar', '#pieceDetailPanel'],
      4: ['.hashing-section', '#predictHash', '#flipDemo', '#errorSim', '#hashTableContainer'],
      5: ['.meta-section', '#predictMeta', '#metaHumanView', '.info-hash-section'],
      6: ['.sim-container', '.sim-controls', '#simStats', '#rarestFirstSection', '#recapSection']
    };
    (selectors[step] || ['.step-content']).forEach(sel => {
      stepEl.querySelectorAll(sel).forEach(el => el.classList.add('focus-target'));
    });
  }

  function updateLearningProgress() {
    const container = $('learningProgress');
    if (!container) return;
    const milestones = [
      { label: 'File loaded', completed: state.milestones.fileLoaded },
      { label: 'Pieces created', completed: state.milestones.piecesCreated },
      { label: 'Hashes computed', completed: state.milestones.hashesComputed },
      { label: 'Metadata assembled', completed: state.milestones.metadataAssembled },
      { label: 'Swarm simulated', completed: state.milestones.swarmSimulated }
    ];
    const completed = milestones.filter(milestone => milestone.completed).length;
    const pct = Math.round((completed / milestones.length) * 100);
    const nextMilestoneLabel = milestones.find(milestone => !milestone.completed)?.label || 'All milestones complete';
    container.innerHTML = `
      <div class="learning-progress-track" role="progressbar" aria-label="Learning progress milestones" aria-valuemin="0" aria-valuemax="${milestones.length}" aria-valuenow="${completed}">
        <div class="learning-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="learning-progress-label">${completed}/${milestones.length} milestones complete • Current: ${nextMilestoneLabel}</div>
    `;
  }

  function updateContinuityRail() {
    const el = $('continuityRail');
    if (!el) return;
    const displayPieceCount = Math.min(Math.max(state.pieces.length || 1, CONTINUITY_MIN_PIECES), CONTINUITY_MAX_PIECES);
    let html = '<div class="continuity-track">';
    for (let i = 0; i < displayPieceCount; i++) {
      const hasPiece = state.pieces.length > 0;
      const hasHash = state.hashes.length > i;
      const distributed = state.milestones.swarmSimulated;
      const active = hasPiece ? ' active' : '';
      const hashCls = hasHash ? ' has-hash' : '';
      const distCls = distributed ? ' distributed' : '';
      html += `<div class="continuity-piece${active}${hashCls}${distCls}" style="background-color:${hasPiece ? UI.getPieceColor(i) : CONTINUITY_EMPTY_COLOR}"></div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function toggleHashDisplay(codeEl, toggleBtn) {
    const full = codeEl.dataset.fullHash || '';
    const isShort = codeEl.dataset.state !== 'full';
    codeEl.textContent = isShort ? UI.formatHashDisplay(full) : UI.shortHashDisplay(full);
    codeEl.dataset.state = isShort ? 'full' : 'short';
    codeEl.classList.toggle('short', !isShort);
    toggleBtn.title = isShort ? 'Collapse hash' : 'Expand hash';
  }

  /* ── Error Simulation ── */
  function setupErrorSim() {
    const btn = $('runErrorSimBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async function() {
      this.disabled = true;
      const steps = ['errStep1','errStep2','errStep3','errStep4'];
      const detail = $('errorSimDetail');

      // Reset
      steps.forEach(id => {
        const el = $(id);
        if (el) el.classList.remove('active','done-ok','done-fail');
      });
      detail.textContent = '';

      const piece0 = state.pieces[0];
      const expectedHash = state.hashes[0];

      // Corrupt the piece
      const corrupted = Hasher.flipRandomByte(piece0.data);

      const animate = (stepId, cls, msg, delay) => new Promise(r => setTimeout(() => {
        const el = $(stepId);
        if (el) { el.classList.remove('active'); el.classList.add(cls); }
        detail.textContent += msg + '\n';
        r();
      }, delay));

      await animate('errStep1', 'active', '📦 Corrupted piece received…', 0);
      await animate('errStep1', 'done-fail', '→ Piece data corrupted in transit', 600);
      await animate('errStep2', 'active', '🔐 Computing SHA-1 of received data…', 800);
      const receivedHash = await Hasher.hashPiece(corrupted.modified);
      await animate('errStep2', 'done-ok', `→ Computed hash: ${receivedHash.slice(0,16)}…`, 1400);
      await animate('errStep3', 'active', '⚖️ Comparing with expected hash…', 1800);
      detail.textContent += `Expected:  ${expectedHash.slice(0,16)}…\n`;
      detail.textContent += `Received:  ${receivedHash.slice(0,16)}…\n`;
      await new Promise(r => setTimeout(r, 800));
      await animate('errStep3', 'done-fail', '→ MISMATCH — hashes do not match!', 2600);
      await animate('errStep4', 'active', '❌ Piece rejected — will re-download', 3000);
      await animate('errStep4', 'done-fail', '→ Client queues piece for re-download', 3600);
      detail.textContent += '\n✅ Result: Corrupt data never accepted. Re-download queued.';

      this.disabled = false;
      this.textContent = '↺ Run Again';
    });
  }

  /* ── Recap + Mini Quiz ── */
  function setupRecapQuiz() {
    const quizContainer = $('quizQuestions');
    if (!quizContainer || quizContainer.dataset.bound) return;
    quizContainer.dataset.bound = '1';

    const questions = [
      {
        q: 'Does a .torrent file contain the original file?',
        options: ['Yes, the file is embedded in the .torrent', 'No — it only contains metadata and hashes', 'It contains a compressed version'],
        correct: 1
      },
      {
        q: 'Why are hashes needed for each piece?',
        options: ['To compress data for faster download', 'To detect corrupt or tampered pieces before accepting them', 'To encrypt the pieces during transfer'],
        correct: 1
      },
      {
        q: 'Why split a file into pieces instead of downloading it whole?',
        options: ['To make the file smaller on disk', 'So different peers can share different parts simultaneously', 'Because BitTorrent only supports small file sizes'],
        correct: 1
      }
    ];

    questions.forEach((q, qi) => {
      const div = document.createElement('div');
      div.className = 'quiz-question';
      div.innerHTML = `<div class="quiz-q-text">${qi + 1}. ${q.q}</div>`;
      const opts = document.createElement('div');
      opts.className = 'quiz-options';
      q.options.forEach((opt, oi) => {
        const label = document.createElement('label');
        label.className = 'quiz-option';
        label.dataset.qi = qi;
        label.dataset.oi = oi;
        label.innerHTML = `<input type="radio" name="q${qi}" value="${oi}" style="display:none"> ${opt}`;
        label.addEventListener('click', function() {
          opts.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
          this.classList.add('selected');
          this.querySelector('input').checked = true;
        });
        opts.appendChild(label);
      });
      div.appendChild(opts);
      quizContainer.appendChild(div);
    });

    const submitBtn = $('submitQuizBtn');
    if (submitBtn) {
      submitBtn.classList.remove('hidden');
      submitBtn.addEventListener('click', function() {
        let score = 0;
        questions.forEach((q, qi) => {
          const selected = quizContainer.querySelector(`[data-qi="${qi}"].selected`);
          const allOpts = quizContainer.querySelectorAll(`[data-qi="${qi}"]`);
          allOpts.forEach(o => {
            const oi = parseInt(o.dataset.oi);
            if (oi === q.correct) o.classList.add('correct');
            else if (o.classList.contains('selected') && oi !== q.correct) o.classList.add('wrong');
          });
          if (selected && parseInt(selected.dataset.oi) === q.correct) score++;
        });
        this.disabled = true;
        const resultEl = $('quizResult');
        resultEl.classList.remove('hidden', 'good', 'ok', 'retry');
        if (score === 3) {
          resultEl.className = 'quiz-result good';
          resultEl.textContent = '🎉 Perfect score! You truly understand how BitTorrent works.';
          showToast('🏆 Perfect quiz score!', 'success');
        } else if (score >= 2) {
          resultEl.className = 'quiz-result ok';
          resultEl.textContent = `👍 ${score}/3 correct. Good understanding — re-read the highlighted steps above!`;
        } else {
          resultEl.className = 'quiz-result retry';
          resultEl.textContent = `${score}/3 correct. Go back through the steps and try again — you'll get there!`;
        }
      });
    }
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

  function showToast(msg, style) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast' + (style === 'success' ? ' toast-success' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  /* ── Boot ── */
  function init() {
    setupFileInput();
    setupExplanationToggles();

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
    updateLearningProgress();
    updateContinuityRail();
    goToStep(0);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
