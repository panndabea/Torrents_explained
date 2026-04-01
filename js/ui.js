/* ui.js — UI helpers: piece bar, tooltips, step indicator, skeletons */

'use strict';

const UI = (() => {

  const PIECE_COLORS = [
    '#3b82f6','#8b5cf6','#10b981','#f59e0b','#ec4899',
    '#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6',
    '#a855f7','#22c55e','#ef4444','#0ea5e9','#d946ef','#fb923c'
  ];

  function getPieceColor(index) {
    return PIECE_COLORS[index % PIECE_COLORS.length];
  }

  /**
   * Render the piece bar into a container element.
   * @param {Array<{index,start,end,size}>} pieces
   * @param {HTMLElement} container
   * @param {function(piece,el):void} onPieceClick
   * @param {number} maxDisplay  max pieces to render (rest shown as "…")
   */
  function createPieceBar(pieces, container, onPieceClick, maxDisplay = 100) {
    container.innerHTML = '';
    const display = pieces.slice(0, maxDisplay);
    const totalBytes = pieces[pieces.length - 1].end;

    for (const piece of display) {
      const el = document.createElement('div');
      el.className = 'piece-block';
      el.style.backgroundColor = getPieceColor(piece.index);
      el.style.width = `${Math.max((piece.size / totalBytes) * 100, 0.3)}%`;
      el.dataset.index = piece.index;
      el.title = `Piece #${piece.index}`;

      el.addEventListener('click', () => {
        // Deselect others
        container.querySelectorAll('.piece-block.selected').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
        if (onPieceClick) onPieceClick(piece, el);
      });

      el.addEventListener('mouseenter', () => {
        if (!el.classList.contains('selected')) {
          el.style.filter = 'brightness(1.4)';
          el.style.transform = 'scaleY(1.3)';
        }
      });
      el.addEventListener('mouseleave', () => {
        if (!el.classList.contains('selected')) {
          el.style.filter = '';
          el.style.transform = '';
        }
      });

      container.appendChild(el);
    }

    if (pieces.length > maxDisplay) {
      const more = document.createElement('div');
      more.className = 'piece-block piece-overflow';
      more.style.backgroundColor = '#334155';
      more.style.width = '20px';
      more.style.minWidth = '20px';
      more.textContent = '…';
      more.title = `+${pieces.length - maxDisplay} more pieces`;
      container.appendChild(more);
    }
  }

  /**
   * Animate the splitting of a file bar into pieces.
   * @param {HTMLElement} pieceBar  the piece-bar container
   */
  function animateSplitting(pieceBar) {
    const blocks = pieceBar.querySelectorAll('.piece-block:not(.piece-overflow)');
    blocks.forEach((block, i) => {
      block.style.opacity = '0';
      block.style.transform = 'scaleY(0)';
      block.style.transition = 'none';
      setTimeout(() => {
        block.style.transition = `opacity 0.3s ease ${i * 8}ms, transform 0.3s ease ${i * 8}ms`;
        block.style.opacity = '1';
        block.style.transform = 'scaleY(1)';
      }, 50 + i * 8);
    });
  }

  /**
   * Update the step indicator bar.
   * @param {number} currentStep  0-6
   * @param {number} totalSteps
   * @param {HTMLElement} container
   */
  function updateStepIndicator(currentStep, totalSteps, container) {
    container.innerHTML = '';
    const labels = ['Intro','File','Pieces','Visualize','Hash','Metadata','Network'];
    for (let i = 0; i < totalSteps; i++) {
      const item = document.createElement('div');
      item.className = 'step-ind-item' +
        (i === currentStep ? ' active' : '') +
        (i < currentStep ? ' done' : '');
      item.innerHTML = `
        <div class="step-ind-dot">
          ${i < currentStep ? '✓' : i + 1}
        </div>
        <span class="step-ind-label">${labels[i] || i}</span>
      `;
      container.appendChild(item);
      if (i < totalSteps - 1) {
        const line = document.createElement('div');
        line.className = 'step-ind-line' + (i < currentStep ? ' done' : '');
        container.appendChild(line);
      }
    }
  }

  /**
   * Update the bottom dot navigation.
   * @param {number} currentStep
   * @param {number} totalSteps
   * @param {HTMLElement} container
   */
  function updateStepDots(currentStep, totalSteps, container) {
    container.innerHTML = '';
    for (let i = 0; i < totalSteps; i++) {
      const dot = document.createElement('div');
      dot.className = 'step-dot' + (i === currentStep ? ' active' : '') + (i < currentStep ? ' done' : '');
      container.appendChild(dot);
    }
  }

  /**
   * Show a skeleton loading state in a container.
   * @param {HTMLElement} container
   * @param {number} lines
   */
  function showSkeleton(container, lines = 3) {
    container.innerHTML = '';
    for (let i = 0; i < lines; i++) {
      const sk = document.createElement('div');
      sk.className = 'skeleton-line';
      sk.style.width = `${60 + Math.random() * 35}%`;
      container.appendChild(sk);
    }
  }

  /**
   * Remove skeleton content.
   * @param {HTMLElement} container
   */
  function hideSkeleton(container) {
    container.querySelectorAll('.skeleton-line').forEach(el => el.remove());
  }

  /**
   * Show a custom tooltip near an element.
   * @param {HTMLElement} el
   * @param {string} text
   */
  function showTooltip(el, text) {
    hideTooltip();
    const tip = document.createElement('div');
    tip.id = 'global-tooltip';
    tip.className = 'custom-tooltip';
    tip.textContent = text;
    document.body.appendChild(tip);
    const rect = el.getBoundingClientRect();
    tip.style.left = `${rect.left + rect.width / 2 - tip.offsetWidth / 2}px`;
    tip.style.top = `${rect.top - tip.offsetHeight - 8 + window.scrollY}px`;
  }

  function hideTooltip() {
    const tip = document.getElementById('global-tooltip');
    if (tip) tip.remove();
  }

  /**
   * Render the rarest-first visualization bar.
   * @param {Array<{index,count,pct}>} rarityData
   * @param {HTMLElement} container
   * @param {number} numPeers
   */
  function renderRarityBar(rarityData, container, numPeers) {
    container.innerHTML = '';
    for (const d of rarityData) {
      const cell = document.createElement('div');
      cell.className = 'rarity-cell' + (d.count <= 1 ? ' rarest' : '');
      cell.style.backgroundColor = PIECE_COLORS[d.index % PIECE_COLORS.length];
      cell.style.opacity = 0.3 + (d.pct * 0.7);
      cell.title = `Piece #${d.index}: ${d.count}/${numPeers} peers`;
      container.appendChild(cell);
    }
  }

  /**
   * Render the piece segmentation preview in step 2.
   * @param {number} fileSize
   * @param {number} pieceLength
   * @param {HTMLElement} container
   */
  function renderPiecePreview(fileSize, pieceLength, container) {
    container.innerHTML = '';
    const numPieces = Math.ceil(fileSize / pieceLength);
    const maxShow = 40;
    const show = Math.min(numPieces, maxShow);

    const bar = document.createElement('div');
    bar.className = 'preview-bar';

    for (let i = 0; i < show; i++) {
      const bl = document.createElement('div');
      bl.className = 'preview-block';
      bl.style.backgroundColor = getPieceColor(i);
      bar.appendChild(bl);
    }
    if (numPieces > maxShow) {
      const more = document.createElement('div');
      more.className = 'preview-block preview-more';
      more.textContent = `+${numPieces - maxShow}`;
      bar.appendChild(more);
    }
    container.appendChild(bar);

    const note = document.createElement('p');
    note.className = 'preview-note';
    note.textContent = `${numPieces.toLocaleString()} pieces × ${FileProcessor.humanPieceSize(pieceLength)} each`;
    container.appendChild(note);
  }

  /**
   * Build the human-readable metadata tree HTML.
   * @param {object} meta
   * @param {string[]} hashes
   * @returns {string} HTML
   */
  function buildMetaTreeHTML(meta, hashes) {
    const MAX_HASHES = 20;
    const info = meta.info;
    const showHashes = hashes.slice(0, MAX_HASHES);
    const hidden = hashes.length - MAX_HASHES;

    let html = `
    <div class="meta-node root">
      <div class="meta-key">torrent</div>
      <div class="meta-children">
        <div class="meta-node">
          <div class="meta-key">announce</div>
          <div class="meta-val string">"${meta.announce}"</div>
        </div>
        <div class="meta-node">
          <div class="meta-key">created by</div>
          <div class="meta-val string">"${meta['created by']}"</div>
        </div>
        <div class="meta-node">
          <div class="meta-key">creation date</div>
          <div class="meta-val number">${meta['creation date']} <span class="meta-hint">(Unix timestamp)</span></div>
        </div>
        <div class="meta-node">
          <div class="meta-key meta-expandable" data-target="infoTree">▼ info <span class="meta-badge">dict</span></div>
          <div class="meta-children" id="infoTree">
            <div class="meta-node">
              <div class="meta-key">name</div>
              <div class="meta-val string">"${escapeHtml(info.name)}"</div>
            </div>
            <div class="meta-node">
              <div class="meta-key">length</div>
              <div class="meta-val number">${info.length.toLocaleString()} <span class="meta-hint">(${FileProcessor.humanSize(info.length)})</span></div>
            </div>
            <div class="meta-node">
              <div class="meta-key">piece length</div>
              <div class="meta-val number">${info['piece length'].toLocaleString()} <span class="meta-hint">(${FileProcessor.humanPieceSize(info['piece length'])})</span></div>
            </div>
            <div class="meta-node">
              <div class="meta-key meta-expandable" data-target="hashTree">▼ pieces <span class="meta-badge">${hashes.length} × SHA-1</span></div>
              <div class="meta-children hash-list" id="hashTree">
                ${showHashes.map((h, i) => `
                  <div class="hash-entry">
                    <span class="hash-index">#${i}</span>
                    <code class="hash-code" data-full-hash="${h}" data-state="short" style="border-left:3px solid ${getPieceColor(i)}">${shortHashDisplay(h)}</code>
                    <button class="copy-btn-sm hash-toggle-btn" data-hash="${h}" title="Expand hash">↕</button>
                    <button class="copy-btn-sm" data-hash="${h}" title="Copy hash">📋</button>
                  </div>
                `).join('')}
                ${hidden > 0 ? `<div class="hash-more">… and ${hidden} more hashes</div>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    return html;
  }

  function formatHashDisplay(hash) {
    return Hasher.formatHash(hash);
  }

  function shortHashDisplay(hash) {
    if (!hash || hash.length < 8) return hash || '';
    return `${hash.slice(0, 4)}...${hash.slice(-4)}`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    getPieceColor,
    createPieceBar,
    animateSplitting,
    updateStepIndicator,
    updateStepDots,
    showSkeleton,
    hideSkeleton,
    showTooltip,
    hideTooltip,
    renderRarityBar,
    renderPiecePreview,
    buildMetaTreeHTML,
    formatHashDisplay,
    shortHashDisplay,
    escapeHtml
  };
})();
