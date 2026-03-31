/* networkSim.js — Canvas-based BitTorrent peer simulation */

'use strict';

class NetworkSimulation {
  constructor(canvasEl, numPieces) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.numPieces = Math.min(numPieces, 16); // cap for visual clarity
    this.animId = null;
    this.running = false;
    this.onStats = null; // callback({distributed, seeders, leechers})

    // Piece color palette
    this.palette = [
      '#3b82f6','#8b5cf6','#10b981','#f59e0b','#ec4899',
      '#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6',
      '#a855f7','#22c55e','#ef4444','#0ea5e9','#d946ef','#fb923c'
    ];

    this.peers = [];
    this.packets = [];
    this.tick = 0;

    this._resize();
    this._buildPeers();
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.min(rect.width || 700, 700);
    const h = Math.min(w * 0.65, 460);
    this.canvas.width = w;
    this.canvas.height = h;
    this.cx = w / 2;
    this.cy = h / 2;
    this.radius = Math.min(w, h) * 0.35;
  }

  _buildPeers() {
    this.peers = [];
    const N = 7; // total nodes: 1 seeder + 6 leechers
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const r = i === 0 ? this.radius * 0.55 : this.radius;
      const x = this.cx + Math.cos(angle) * r;
      const y = this.cy + Math.sin(angle) * r;
      const pieces = new Array(this.numPieces).fill(false);
      if (i === 0) pieces.fill(true); // seeder has all
      this.peers.push({
        id: i,
        x, y,
        isSeeder: i === 0,
        pieces,
        nodeRadius: i === 0 ? 32 : 26,
        label: i === 0 ? 'Seeder' : `Peer ${i}`,
        color: i === 0 ? '#10b981' : '#3b82f6',
        glow: i === 0 ? 0.8 : 0,
        transferCooldown: 0
      });
    }
    this.packets = [];
    this.tick = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = null;
  }

  reset() {
    this.stop();
    this._resize();
    this._buildPeers();
    this._draw();
    this._emitStats();
  }

  _loop() {
    if (!this.running) return;
    this.tick++;

    // Every ~40 ticks, initiate transfers
    if (this.tick % 40 === 0) {
      this._scheduleTransfers();
    }

    // Advance packets
    for (const p of this.packets) {
      p.progress += p.speed;
    }

    // Deliver arrived packets
    const arrived = this.packets.filter(p => p.progress >= 1);
    for (const p of arrived) {
      if (!this.peers[p.to].pieces[p.pieceIndex]) {
        this.peers[p.to].pieces[p.pieceIndex] = true;
        this.peers[p.to].glow = 1.0;
      }
    }
    this.packets = this.packets.filter(p => p.progress < 1);

    // Update peer states
    for (const peer of this.peers) {
      if (peer.glow > 0) peer.glow -= 0.02;
      peer.transferCooldown = Math.max(0, peer.transferCooldown - 1);
      const total = peer.pieces.filter(Boolean).length;
      if (!peer.isSeeder) {
        if (total === this.numPieces) {
          peer.color = '#10b981'; // became a seeder
          peer.isSeeder = true;
        } else if (total > 0) {
          peer.color = '#8b5cf6'; // partial
        }
      }
    }

    this._draw();
    this._emitStats();

    this.animId = requestAnimationFrame(() => this._loop());
  }

  _scheduleTransfers() {
    // Compute piece rarity: how many peers have each piece
    const rarity = new Array(this.numPieces).fill(0);
    for (const peer of this.peers) {
      for (let i = 0; i < this.numPieces; i++) {
        if (peer.pieces[i]) rarity[i]++;
      }
    }

    // For each leecher, find the rarest piece they don't have and find a peer to get it from
    for (const leecher of this.peers) {
      if (leecher.transferCooldown > 0) continue;
      if (leecher.pieces.every(Boolean)) continue; // already complete

      // Rarest-first: find the missing piece with lowest rarity
      let bestPiece = -1, bestRarity = Infinity;
      for (let i = 0; i < this.numPieces; i++) {
        if (!leecher.pieces[i] && rarity[i] > 0 && rarity[i] < bestRarity) {
          bestRarity = rarity[i];
          bestPiece = i;
        }
      }
      if (bestPiece === -1) continue;

      // Find a peer that has this piece
      const sources = this.peers.filter(p => p.id !== leecher.id && p.pieces[bestPiece]);
      if (sources.length === 0) continue;
      const source = sources[Math.floor(Math.random() * sources.length)];

      this.packets.push({
        from: source.id,
        to: leecher.id,
        pieceIndex: bestPiece,
        progress: 0,
        speed: 0.015 + Math.random() * 0.01,
        color: this.palette[bestPiece % this.palette.length]
      });
      leecher.transferCooldown = 30 + Math.floor(Math.random() * 20);
    }
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Draw edges between all peers
    for (let i = 0; i < this.peers.length; i++) {
      for (let j = i + 1; j < this.peers.length; j++) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(51,65,85,0.5)';
        ctx.lineWidth = 1;
        ctx.moveTo(this.peers[i].x, this.peers[i].y);
        ctx.lineTo(this.peers[j].x, this.peers[j].y);
        ctx.stroke();
      }
    }

    // Draw packets
    for (const p of this.packets) {
      const src = this.peers[p.from];
      const dst = this.peers[p.to];
      const x = src.x + (dst.x - src.x) * p.progress;
      const y = src.y + (dst.y - src.y) * p.progress;

      // Trail
      ctx.beginPath();
      ctx.strokeStyle = p.color + '44';
      ctx.lineWidth = 2;
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(x, y);
      ctx.stroke();

      // Packet dot
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Draw peers
    for (const peer of this.peers) {
      const nr = peer.nodeRadius;
      // Glow
      if (peer.glow > 0) {
        ctx.beginPath();
        const grad = ctx.createRadialGradient(peer.x, peer.y, nr * 0.5, peer.x, peer.y, nr * 2.5);
        grad.addColorStop(0, peer.color + Math.round(peer.glow * 60).toString(16).padStart(2,'0'));
        grad.addColorStop(1, 'transparent');
        ctx.arc(peer.x, peer.y, nr * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(peer.x, peer.y, nr, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = peer.color;
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();

      // Piece progress ring
      const total = peer.pieces.filter(Boolean).length;
      const pct = total / this.numPieces;
      if (pct > 0) {
        ctx.beginPath();
        ctx.arc(peer.x, peer.y, nr + 5, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.strokeStyle = peer.color;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Mini piece grid inside node
      this._drawPieceGrid(ctx, peer);

      // Label
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText(peer.label, peer.x, peer.y + nr + 18);

      // Piece count
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = peer.color;
      ctx.fillText(`${total}/${this.numPieces}`, peer.x, peer.y + nr + 30);
    }
  }

  _drawPieceGrid(ctx, peer) {
    const pieces = peer.pieces;
    const n = pieces.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellSize = Math.min((peer.nodeRadius * 1.2) / cols, (peer.nodeRadius * 1.2) / rows);
    const gridW = cols * cellSize;
    const gridH = rows * cellSize;
    const startX = peer.x - gridW / 2;
    const startY = peer.y - gridH / 2;

    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellSize;
      const y = startY + row * cellSize;
      ctx.fillStyle = pieces[i] ? this.palette[i % this.palette.length] : '#334155';
      ctx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }
  }

  _emitStats() {
    if (!this.onStats) return;
    const seeders = this.peers.filter(p => p.pieces.every(Boolean)).length;
    const leechers = this.peers.filter(p => !p.pieces.every(Boolean)).length;
    const totalPossible = this.peers.length * this.numPieces;
    const totalHave = this.peers.reduce((s, p) => s + p.pieces.filter(Boolean).length, 0);
    const distributed = Math.round((totalHave / totalPossible) * 100);
    this.onStats({ distributed, seeders, leechers });
  }

  /**
   * Return rarity data for each piece (how many peers have it).
   * @returns {Array<{index,count,pct}>}
   */
  getRarityData() {
    return this.peers[0].pieces.map((_, i) => {
      const count = this.peers.filter(p => p.pieces[i]).length;
      return { index: i, count, pct: count / this.peers.length };
    });
  }
}
