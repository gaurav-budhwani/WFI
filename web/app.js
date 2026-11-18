/* Whiteboard Application Main Controller
   Freeform layout, iPad Apple Pencil gestures (1-finger draw, 1-finger pan in hand mode,
   2-finger pan & pinch zoom in all modes, Apple Pencil double-tap toggle eraser),
   Laser Pointer highlighter (GoodNotes glowing red dot with vanishing trail),
   Pen styles (Fountain, Normal, Marker, Pencil), Shapes, Text Box, Table,
   Black & White theme, and Real-time room live sharing.
   Zero emojis, clean plain implementation.
*/

import { StrokeRenderer, OverlayManager } from './tools.js';
import { RealtimeManager } from './realtime.js';

class WhiteboardApp {
  constructor() {
    // DOM Elements
    this.viewport = document.getElementById('canvasViewport');
    this.gridCanvas = document.getElementById('gridCanvas');
    this.boardCanvas = document.getElementById('boardCanvas');
    this.laserCanvas = document.getElementById('laserCanvas');
    this.laserDotCursor = document.getElementById('laserDotCursor');

    this.gridCtx = this.gridCanvas.getContext('2d');
    this.boardCtx = this.boardCanvas.getContext('2d');
    this.laserCtx = this.laserCanvas.getContext('2d');
    this.overlayContainer = document.getElementById('canvasOverlay');

    // Toolbars & Controls
    this.sidebar = document.getElementById('sidebar');
    this.sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    this.sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    this.boardTitleInput = document.getElementById('boardTitleInput');
    this.topbarRoomPill = document.getElementById('topbarRoomPill');
    this.topbarRoomCode = document.getElementById('topbarRoomCode');
    this.topbarCopyCodeBtn = document.getElementById('topbarCopyCodeBtn');
    this.penSettingsDrawer = document.getElementById('penSettingsDrawer');
    this.themeToggleBtn = document.getElementById('themeToggleBtn');
    this.shareBtn = document.getElementById('shareBtn');
    this.shareDialog = document.getElementById('shareDialog');
    this.closeShareModalBtn = document.getElementById('closeShareModalBtn');
    this.shapeMenu = document.getElementById('shapeMenu');
    this.toolShapeBtn = document.getElementById('toolShape');
    this.roomStatusBadge = document.getElementById('roomStatusBadge');
    this.roomStatusLabel = document.getElementById('roomStatusLabel');
    this.toastNotification = document.getElementById('toastNotification');

    // Sliders & Style Buttons
    this.penOpacitySlider = document.getElementById('penOpacitySlider');
    this.penOpacityVal = document.getElementById('penOpacityVal');
    this.penSizeSlider = document.getElementById('penSizeSlider');
    this.penSizeVal = document.getElementById('penSizeVal');
    this.colorPalette = document.getElementById('colorPalette');

    // Zoom Controls
    this.zoomOutBtn = document.getElementById('zoomOutBtn');
    this.zoomInBtn = document.getElementById('zoomInBtn');
    this.zoomResetBtn = document.getElementById('zoomResetBtn');
    this.zoomLevelText = document.getElementById('zoomLevelText');
    this.undoBtn = document.getElementById('undoBtn');
    this.redoBtn = document.getElementById('redoBtn');
    this.fitViewBtn = document.getElementById('fitViewBtn');
    this.gridToggleBtn = document.getElementById('gridToggleBtn');
    this.clearCanvasBtn = document.getElementById('clearCanvasBtn');

    // Share Modal Elements
    this.tabHost = document.getElementById('tabHost');
    this.tabJoin = document.getElementById('tabJoin');
    this.hostView = document.getElementById('hostView');
    this.joinView = document.getElementById('joinView');
    this.displayRoomCode = document.getElementById('displayRoomCode');
    this.copyCodeBtn = document.getElementById('copyCodeBtn');
    this.wifiUrlInput = document.getElementById('wifiUrlInput');
    this.copyWifiUrlBtn = document.getElementById('copyWifiUrlBtn');
    this.shareLinkInput = document.getElementById('shareLinkInput');
    this.copyLinkBtn = document.getElementById('copyLinkBtn');
    this.broadcastViewportCheckbox = document.getElementById('broadcastViewportCheckbox');
    this.connectedCountText = document.getElementById('connectedCountText');
    this.joinCodeInput = document.getElementById('joinCodeInput');
    this.connectRoomBtn = document.getElementById('connectRoomBtn');
    this.joinStatusMessage = document.getElementById('joinStatusMessage');
    this.newBoardBtn = document.getElementById('newBoardBtn');

    // Canvas Transformation State
    this.panX = 0;
    this.panY = 0;
    this.scale = 1.0;
    this.minScale = 0.25;
    this.maxScale = 4.0;
    this.gridStyle = 'dots';
    this.dpr = window.devicePixelRatio || 1;

    // Tool State
    this.currentTool = 'pen'; // 'pen' | 'hand' | 'laser' | 'eraser' | 'shape' | 'text' | 'table' | 'note'
    this.previousToolBeforeEraser = 'pen';
    this.penStyle = 'fountain';
    this.penOpacity = 1.0;
    this.penSize = 4;
    this.penColor = '#ffffff';
    this.selectedShape = 'line';

    // Whiteboard Data
    this.strokes = [];
    this.shapes = [];
    this.undoStack = [];
    this.redoStack = [];

    // Pointer & Gesture Tracking
    this.activePointers = new Map();
    this.isDrawing = false;
    this.currentStroke = null;
    this.isPanning = false;
    this.panStartScreenX = 0;
    this.panStartScreenY = 0;
    this.panOriginX = 0;
    this.panOriginY = 0;

    // 2-Finger Pinch & Pan State
    this.isPinching = false;
    this.pinchInitialDistance = 0;
    this.pinchInitialScale = 1;
    this.pinchCenterWorldX = 0;
    this.pinchCenterWorldY = 0;

    // Apple Pencil Double Tap Detection
    this.lastPencilTapTime = 0;
    this.lastPencilTapX = 0;
    this.lastPencilTapY = 0;

    // Shape Preview State
    this.isDrawingShape = false;
    this.currentShapePreview = null;

    // GoodNotes Laser Pointer State
    this.isLaserActive = false;
    this.laserTrail = []; // { x, y, timestamp }
    this.remoteLaserTrail = []; // { x, y, timestamp }
    this.remoteLaserActive = false;
    this.remoteLaserPos = { x: 0, y: 0 };
    this.laserAnimFrame = null;

    // Subsystems
    this.overlayManager = new OverlayManager(this.overlayContainer, {
      onElementChange: (action, data) => {
        this.saveHistorySnapshot();
        this.realtime.broadcastOverlayChange(action, data);
        if (this.realtime.isHost) {
          this.realtime.broadcastFullState(this.serializeBoard());
        }
      }
    });

    this.realtime = new RealtimeManager({
      onHostReady: (code, url) => {
        this.topbarRoomCode.innerText = code;
        this.displayRoomCode.innerText = code;
        this.shareLinkInput.value = url;
        this.roomStatusLabel.innerText = `Host: ${code}`;
        this.roomStatusBadge.className = 'room-status-badge live';
        this.fetchWifiInfo(code);
      },
      onJoined: (code) => {
        this.topbarRoomCode.innerText = code;
        this.roomStatusLabel.innerText = `Joined: ${code}`;
        this.roomStatusBadge.className = 'room-status-badge connected';
        this.showToast(`Connected to room ${code}`);
        this.shareDialog.close();
      },
      onStatusChange: (status, message, count) => {
        if (status === 'error') {
          this.joinStatusMessage.className = 'join-status-message error';
          this.joinStatusMessage.innerText = message;
          this.showToast(message);
        } else if (status === 'connecting') {
          this.joinStatusMessage.className = 'join-status-message';
          this.joinStatusMessage.innerText = message;
        } else if (status === 'joined') {
          this.joinStatusMessage.className = 'join-status-message success';
          this.joinStatusMessage.innerText = message;
        }
      },
      onParticipantCountChange: (count) => {
        this.connectedCountText.innerText = `${count} participant${count === 1 ? '' : 's'} connected`;
      },
      getFullBoardState: () => {
        return this.serializeBoard();
      },
      getViewport: () => {
        return { panX: this.panX, panY: this.panY, scale: this.scale };
      },
      onFullBoardReceived: (boardData, viewport) => {
        this.deserializeBoard(boardData);
        if (viewport && this.realtime.broadcastViewport) {
          this.panX = viewport.panX;
          this.panY = viewport.panY;
          this.scale = viewport.scale;
          this.applyTransform();
        }
      },
      onRemoteStrokeStart: (stroke) => {
        this.strokes.push(stroke);
      },
      onRemoteStrokePoint: (strokeId, point) => {
        const stroke = this.strokes.find(s => s.id === strokeId);
        if (stroke) {
          stroke.points.push(point);
          this.redrawBoard();
        }
      },
      onRemoteStrokeEnd: (strokeId) => {
        this.redrawBoard();
      },
      onRemoteLaser: (data) => {
        this.handleRemoteLaser(data);
      },
      onRemoteShapeAdd: (shape) => {
        this.shapes.push(shape);
        this.redrawBoard();
      },
      onRemoteOverlayChange: (action, data) => {
        this.overlayManager.syncRemoteUpdate(action, data);
      },
      onRemoteClear: () => {
        this.clearBoard(false);
      },
      onRemoteUndo: () => {
        this.undo(false);
      },
      onRemoteRedo: () => {
        this.redo(false);
      },
      onRemoteViewport: (viewport) => {
        if (viewport) {
          this.panX = viewport.panX;
          this.panY = viewport.panY;
          this.scale = viewport.scale;
          this.applyTransform();
        }
      }
    });

    this.init();
  }

  init() {
    this.setupResizeListener();
    this.setupTheme();
    this.setupToolbarEvents();
    this.setupPenDrawerEvents();
    this.setupCanvasPointerEvents();
    this.setupZoomAndHistoryEvents();
    this.setupShareModal();
    this.setupKeyboardShortcuts();

    // Check URL parameters for direct room joining
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('room') || params.get('join');
    if (joinCode) {
      this.realtime.joinRoom(joinCode);
    } else {
      this.realtime.startHost();
    }

    this.resizeCanvases();
    this.redrawGrid();
    this.redrawBoard();
  }

  fetchWifiInfo(roomCode) {
    fetch('/api/network-info')
      .then(res => res.json())
      .then(info => {
        if (info && info.ipad_url) {
          const fullIpadUrl = `${info.ipad_url}?room=${encodeURIComponent(roomCode)}`;
          if (this.wifiUrlInput) {
            this.wifiUrlInput.value = fullIpadUrl;
          }
          this.renderQrCode(fullIpadUrl);
        }
      })
      .catch(() => {
        const fallbackUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomCode)}`;
        this.renderQrCode(fallbackUrl);
      });
  }

  renderQrCode(url) {
    if (typeof window.qrcode === 'undefined') return;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const container = document.getElementById('qrCodeContainer');
      if (container) {
        container.innerHTML = qr.createSvgTag({ scalable: true });
      }
    } catch (_) {}
  }

  /* ---------------- Resize & DPI Setup ---------------- */
  setupResizeListener() {
    window.addEventListener('resize', () => {
      this.resizeCanvases();
      this.redrawGrid();
      this.redrawBoard();
      this.renderLaserTrail();
    });
  }

  resizeCanvases() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    this.dpr = window.devicePixelRatio || 1;

    this.gridCanvas.width = width * this.dpr;
    this.gridCanvas.height = height * this.dpr;
    this.gridCanvas.style.width = `${width}px`;
    this.gridCanvas.style.height = `${height}px`;

    this.boardCanvas.width = width * this.dpr;
    this.boardCanvas.height = height * this.dpr;
    this.boardCanvas.style.width = `${width}px`;
    this.boardCanvas.style.height = `${height}px`;

    this.laserCanvas.width = width * this.dpr;
    this.laserCanvas.height = height * this.dpr;
    this.laserCanvas.style.width = `${width}px`;
    this.laserCanvas.style.height = `${height}px`;

    this.gridCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.boardCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.laserCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------------- Coordinate Transformation ---------------- */
  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.panX) / this.scale,
      y: (screenY - this.panY) / this.scale
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.scale + this.panX,
      y: worldY * this.scale + this.panY
    };
  }

  applyTransform() {
    this.zoomLevelText.innerText = `${Math.round(this.scale * 100)}%`;
    this.overlayManager.setTransform(this.panX, this.panY, this.scale);
    this.redrawGrid();
    this.redrawBoard();
    this.renderLaserTrail();

    this.realtime.broadcastViewportTransform(this.panX, this.panY, this.scale);
  }

  /* ---------------- Grid Rendering ---------------- */
  redrawGrid() {
    const ctx = this.gridCtx;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (this.gridStyle === 'none') {
      ctx.restore();
      return;
    }

    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const dotSpacing = 28 * this.scale;
    const dotRadius = Math.max(1, 1.2 * Math.min(1.5, this.scale));

    const startX = (this.panX % dotSpacing + dotSpacing) % dotSpacing;
    const startY = (this.panY % dotSpacing + dotSpacing) % dotSpacing;

    if (this.gridStyle === 'dots') {
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.14)';
      for (let x = startX; x < width; x += dotSpacing) {
        for (let y = startY; y < height; y += dotSpacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (this.gridStyle === 'grid') {
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x < width; x += dotSpacing) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = startY; y < height; y += dotSpacing) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ---------------- Board Rendering ---------------- */
  redrawBoard() {
    const ctx = this.boardCtx;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    for (const stroke of this.strokes) {
      StrokeRenderer.renderStroke(ctx, stroke);
    }

    if (this.isDrawing && this.currentStroke) {
      StrokeRenderer.renderStroke(ctx, this.currentStroke);
    }

    for (const shape of this.shapes) {
      StrokeRenderer.renderShape(ctx, shape);
    }

    if (this.isDrawingShape && this.currentShapePreview) {
      StrokeRenderer.renderShape(ctx, this.currentShapePreview);
    }

    ctx.restore();
  }

  /* ---------------- GoodNotes Laser Pointer & Trail ---------------- */
  handleRemoteLaser(data) {
    if (!data.active) {
      this.remoteLaserActive = false;
      return;
    }

    this.remoteLaserActive = true;
    this.remoteLaserPos = { x: data.x, y: data.y };
    this.remoteLaserTrail.push({
      x: data.x,
      y: data.y,
      timestamp: Date.now()
    });

    this.triggerLaserLoop();
  }

  triggerLaserLoop() {
    if (!this.laserAnimFrame) {
      this.laserAnimFrame = requestAnimationFrame(() => this.renderLaserTrail());
    }
  }

  renderLaserTrail() {
    this.laserAnimFrame = null;
    const ctx = this.laserCtx;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    const now = Date.now();
    const trailDuration = 1000; // 1 second vanishing trail

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Apply canvas world transform
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // Filter points older than trail duration
    this.laserTrail = this.laserTrail.filter(pt => now - pt.timestamp < trailDuration);
    this.remoteLaserTrail = this.remoteLaserTrail.filter(pt => now - pt.timestamp < trailDuration);

    // Draw Local Laser Trail
    this.drawFadingLaserSegments(ctx, this.laserTrail, now, trailDuration);

    // Draw Remote Laser Trail & Dot
    this.drawFadingLaserSegments(ctx, this.remoteLaserTrail, now, trailDuration);

    if (this.remoteLaserActive && this.remoteLaserPos) {
      this.drawLaserDot(ctx, this.remoteLaserPos.x, this.remoteLaserPos.y);
    }

    ctx.restore();

    // Continue animation loop if trails still exist or active
    if (this.laserTrail.length > 0 || this.remoteLaserTrail.length > 0 || this.isLaserActive || this.remoteLaserActive) {
      this.laserAnimFrame = requestAnimationFrame(() => this.renderLaserTrail());
    }
  }

  drawFadingLaserSegments(ctx, trail, now, duration) {
    if (trail.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < trail.length - 1; i++) {
      const p1 = trail[i];
      const p2 = trail[i + 1];
      const age = now - p2.timestamp;
      const progress = Math.max(0, Math.min(1, 1 - (age / duration)));
      if (progress <= 0) continue;

      ctx.save();
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 12 * progress;
      ctx.strokeStyle = `rgba(255, 59, 48, ${progress * 0.95})`;
      ctx.lineWidth = Math.max(2, 6 * progress);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawLaserDot(ctx, worldX, worldY) {
    ctx.save();
    ctx.shadowColor = '#ff3b30';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ff3b30';

    ctx.beginPath();
    ctx.arc(worldX, worldY, 7 / this.scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(worldX, worldY, 2.5 / this.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- Pointer / Touch / Apple Pencil Engine ---------------- */
  setupCanvasPointerEvents() {
    const el = this.viewport;

    el.addEventListener('pointerdown', (e) => this.handlePointerDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.handlePointerMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.handlePointerUp(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.handlePointerUp(e), { passive: false });

    el.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    el.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
  }

  handlePointerDown(e) {
    // If interacting directly with an overlay element, do not capture or prevent default!
    if (e.target.closest('#canvasOverlay') || e.target.closest('.canvas-element')) {
      return;
    }

    e.preventDefault();
    this.viewport.setPointerCapture(e.pointerId);

    // Clicking background deselects overlay elements
    this.overlayManager.deselectAll();

    const rect = this.viewport.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = this.screenToWorld(screenX, screenY);
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;

    this.activePointers.set(e.pointerId, {
      screenX,
      screenY,
      worldX: world.x,
      worldY: world.y,
      pointerType: e.pointerType,
      time: Date.now()
    });

    // Detect Apple Pencil Double-Tap
    if (e.pointerType === 'pen') {
      const now = Date.now();
      const timeDiff = now - this.lastPencilTapTime;
      const dist = Math.hypot(screenX - this.lastPencilTapX, screenY - this.lastPencilTapY);
      if (timeDiff < 320 && dist < 14) {
        this.toggleEraserMode();
        this.lastPencilTapTime = 0;
        return;
      }
      this.lastPencilTapTime = now;
      this.lastPencilTapX = screenX;
      this.lastPencilTapY = screenY;
    }

    // 2-Finger Pinch & Pan
    if (this.activePointers.size === 2) {
      if (this.isDrawing) this.cancelCurrentStroke();
      this.isLaserActive = false;
      this.laserDotCursor.hidden = true;
      this.startPinchZoom();
      return;
    }

    // Single Pointer
    if (this.activePointers.size === 1) {
      // Hand tool
      if (this.currentTool === 'hand' || e.button === 1 || e.buttons === 4) {
        this.isPanning = true;
        this.panStartScreenX = screenX;
        this.panStartScreenY = screenY;
        this.panOriginX = this.panX;
        this.panOriginY = this.panY;
        this.viewport.classList.add('panning');
        return;
      }

      // Laser Pointer tool (GoodNotes style)
      if (this.currentTool === 'laser') {
        this.isLaserActive = true;
        this.laserDotCursor.hidden = false;
        this.laserDotCursor.style.left = `${screenX}px`;
        this.laserDotCursor.style.top = `${screenY}px`;

        this.laserTrail.push({ x: world.x, y: world.y, timestamp: Date.now() });
        this.triggerLaserLoop();
        this.realtime.broadcastLaser({ x: world.x, y: world.y, active: true });
        return;
      }

      // Eraser Tool
      if (this.currentTool === 'eraser') {
        this.isDrawing = true;
        this.eraseAtPoint(world.x, world.y, 24 / this.scale);

        const strokeId = `e_${Date.now()}`;
        this.currentStroke = {
          id: strokeId,
          tool: 'eraser',
          style: 'normal',
          color: 'rgba(0,0,0,1)',
          opacity: 1.0,
          size: 28,
          points: [{ x: world.x, y: world.y, pressure: 1.0, time: Date.now() }]
        };
        this.redrawBoard();
        this.realtime.broadcastStrokeStart(this.currentStroke);
        return;
      }

      // Pen Tool
      if (this.currentTool === 'pen') {
        this.isDrawing = true;
        const strokeId = `s_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        this.currentStroke = {
          id: strokeId,
          tool: 'pen',
          style: this.penStyle,
          color: this.penColor,
          opacity: this.penOpacity,
          size: this.penSize,
          points: [{ x: world.x, y: world.y, pressure, time: Date.now() }]
        };
        this.redrawBoard();
        this.realtime.broadcastStrokeStart(this.currentStroke);
        return;
      }

      // Shape Tool
      if (this.currentTool === 'shape') {
        this.isDrawingShape = true;
        this.currentShapePreview = {
          id: `shape_${Date.now()}`,
          shapeType: this.selectedShape,
          startX: world.x,
          startY: world.y,
          endX: world.x,
          endY: world.y,
          color: this.penColor,
          size: this.penSize,
          opacity: this.penOpacity
        };
        this.redrawBoard();
        return;
      }
    }
  }

  handlePointerMove(e) {
    if (!this.activePointers.has(e.pointerId)) return;
    e.preventDefault();

    const rect = this.viewport.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = this.screenToWorld(screenX, screenY);
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;

    const pRecord = this.activePointers.get(e.pointerId);
    pRecord.screenX = screenX;
    pRecord.screenY = screenY;

    if (this.activePointers.size >= 2) {
      this.updatePinchZoom();
      return;
    }

    if (this.isPanning) {
      const dx = screenX - this.panStartScreenX;
      const dy = screenY - this.panStartScreenY;
      this.panX = this.panOriginX + dx;
      this.panY = this.panOriginY + dy;
      this.applyTransform();
      return;
    }

    if (this.currentTool === 'laser' && this.isLaserActive) {
      this.laserDotCursor.style.left = `${screenX}px`;
      this.laserDotCursor.style.top = `${screenY}px`;
      this.laserTrail.push({ x: world.x, y: world.y, timestamp: Date.now() });
      this.triggerLaserLoop();
      this.realtime.broadcastLaser({ x: world.x, y: world.y, active: true });
      return;
    }

    if (this.isDrawing && this.currentStroke) {
      if (this.currentTool === 'eraser') {
        this.eraseAtPoint(world.x, world.y, 24 / this.scale);
      }
      const pt = { x: world.x, y: world.y, pressure, time: Date.now() };
      this.currentStroke.points.push(pt);
      this.redrawBoard();
      this.realtime.broadcastStrokePoint(this.currentStroke.id, pt);
      return;
    }

    if (this.isDrawingShape && this.currentShapePreview) {
      this.currentShapePreview.endX = world.x;
      this.currentShapePreview.endY = world.y;
      this.redrawBoard();
      return;
    }
  }

  handlePointerUp(e) {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.delete(e.pointerId);
      try { this.viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    if (this.isPinching && this.activePointers.size < 2) {
      this.isPinching = false;
    }

    if (this.isPanning && this.activePointers.size === 0) {
      this.isPanning = false;
      this.viewport.classList.remove('panning');
    }

    if (this.currentTool === 'laser') {
      this.isLaserActive = false;
      this.laserDotCursor.hidden = true;
      this.realtime.broadcastLaser({ active: false });
    }

    if (this.isDrawing && this.currentStroke) {
      this.isDrawing = false;
      if (this.currentStroke.points.length > 0) {
        this.saveHistorySnapshot();
        this.strokes.push(this.currentStroke);
        this.realtime.broadcastStrokeEnd(this.currentStroke.id);
        if (this.realtime.isHost) {
          this.realtime.broadcastFullState(this.serializeBoard());
        }
      }
      this.currentStroke = null;
      this.redrawBoard();
    }

    if (this.isDrawingShape && this.currentShapePreview) {
      this.isDrawingShape = false;
      const dx = this.currentShapePreview.endX - this.currentShapePreview.startX;
      const dy = this.currentShapePreview.endY - this.currentShapePreview.startY;
      if (Math.hypot(dx, dy) > 4) {
        this.saveHistorySnapshot();
        this.shapes.push(this.currentShapePreview);
        this.realtime.broadcastShape(this.currentShapePreview);
        if (this.realtime.isHost) {
          this.realtime.broadcastFullState(this.serializeBoard());
        }
      }
      this.currentShapePreview = null;
      this.redrawBoard();
    }
  }

  eraseAtPoint(worldX, worldY, radius) {
    // Erase intersecting shapes
    const initialShapesCount = this.shapes.length;
    this.shapes = this.shapes.filter(s => {
      const minX = Math.min(s.startX, s.endX) - radius;
      const maxX = Math.max(s.startX, s.endX) + radius;
      const minY = Math.min(s.startY, s.endY) - radius;
      const maxY = Math.max(s.startY, s.endY) + radius;
      const hit = worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY;
      return !hit;
    });

    if (this.shapes.length !== initialShapesCount) {
      this.saveHistorySnapshot();
      this.redrawBoard();
    }
  }

  startPinchZoom() {
    this.isPinching = true;
    const [p1, p2] = Array.from(this.activePointers.values());
    this.pinchInitialDistance = Math.hypot(p2.screenX - p1.screenX, p2.screenY - p1.screenY) || 1;
    this.pinchInitialScale = this.scale;

    const midScreenX = (p1.screenX + p2.screenX) / 2;
    const midScreenY = (p1.screenY + p2.screenY) / 2;
    const worldMid = this.screenToWorld(midScreenX, midScreenY);
    this.pinchCenterWorldX = worldMid.x;
    this.pinchCenterWorldY = worldMid.y;
  }

  updatePinchZoom() {
    const [p1, p2] = Array.from(this.activePointers.values());
    if (!p1 || !p2) return;

    const currentDist = Math.hypot(p2.screenX - p1.screenX, p2.screenY - p1.screenY) || 1;
    const currentMidX = (p1.screenX + p2.screenX) / 2;
    const currentMidY = (p1.screenY + p2.screenY) / 2;

    const ratio = currentDist / this.pinchInitialDistance;
    let newScale = this.pinchInitialScale * ratio;
    newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));

    this.scale = newScale;
    this.panX = currentMidX - this.pinchCenterWorldX * this.scale;
    this.panY = currentMidY - this.pinchCenterWorldY * this.scale;

    this.applyTransform();
  }

  cancelCurrentStroke() {
    this.isDrawing = false;
    this.currentStroke = null;
    this.redrawBoard();
  }

  handleWheel(e) {
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = Math.exp(-e.deltaY * 0.01);
      this.zoomAt(screenX, screenY, zoomFactor);
    } else {
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this.applyTransform();
    }
  }

  zoomAt(screenX, screenY, factor) {
    const worldBefore = this.screenToWorld(screenX, screenY);
    let nextScale = this.scale * factor;
    nextScale = Math.max(this.minScale, Math.min(this.maxScale, nextScale));

    this.scale = nextScale;
    this.panX = screenX - worldBefore.x * this.scale;
    this.panY = screenY - worldBefore.y * this.scale;
    this.applyTransform();
  }

  toggleEraserMode() {
    if (this.currentTool === 'eraser') {
      this.setTool(this.previousToolBeforeEraser || 'pen');
      this.showToast('Pen mode');
    } else {
      this.previousToolBeforeEraser = this.currentTool;
      this.setTool('eraser');
      this.showToast('Eraser mode');
    }
  }

  /* ---------------- Tool Switching ---------------- */
  setupToolbarEvents() {
    const toolButtons = document.querySelectorAll('.toolbar-pill .tool-btn');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'shape') {
          this.shapeMenu.hidden = !this.shapeMenu.hidden;
          return;
        }

        this.shapeMenu.hidden = true;
        this.setTool(tool);
      });
    });

    document.querySelectorAll('.popover-item').forEach(item => {
      item.addEventListener('click', () => {
        this.selectedShape = item.dataset.shape;
        this.shapeMenu.hidden = true;
        this.setTool('shape');
        this.showToast(`Shape: ${item.innerText}`);
      });
    });

    document.addEventListener('click', (e) => {
      if (!this.toolShapeBtn.contains(e.target) && !this.shapeMenu.contains(e.target)) {
        this.shapeMenu.hidden = true;
      }
    });

    document.getElementById('toolText').addEventListener('click', () => {
      this.setTool('text');
      const center = this.screenToWorld(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2);
      this.overlayManager.addTextBox({ x: center.x - 60, y: center.y - 20 });
      this.setTool('hand');
    });

    document.getElementById('toolTable').addEventListener('click', () => {
      this.setTool('table');
      const center = this.screenToWorld(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2);
      this.overlayManager.addTable({ x: center.x - 120, y: center.y - 80, rows: 3, cols: 3 });
      this.setTool('hand');
    });

    document.getElementById('toolNote').addEventListener('click', () => {
      this.setTool('note');
      const center = this.screenToWorld(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2);
      this.overlayManager.addNote({ x: center.x - 100, y: center.y - 90 });
      this.setTool('hand');
    });

    this.sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());
    this.sidebarCollapseBtn.addEventListener('click', () => this.toggleSidebar());

    this.newBoardBtn.addEventListener('click', () => {
      if (confirm('Create a new blank board? Current board will be cleared.')) {
        this.clearBoard(true);
        this.boardTitleInput.value = 'Untitled Board';
        this.showToast('New board created');
      }
    });

    // Top bar room pill copy button
    const copyRoomCode = () => {
      if (this.realtime.roomCode) {
        navigator.clipboard.writeText(this.realtime.roomCode).then(() => {
          this.showToast(`Copied room code: ${this.realtime.roomCode}`);
        });
      }
    };
    this.topbarRoomPill.addEventListener('click', copyRoomCode);
    this.topbarCopyCodeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyRoomCode();
    });
  }

  setTool(tool) {
    this.currentTool = tool;

    document.querySelectorAll('.toolbar-pill .tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    this.viewport.classList.remove('hand-mode', 'eraser-mode', 'laser-mode');
    this.laserDotCursor.hidden = true;

    if (tool === 'hand') {
      this.viewport.classList.add('hand-mode');
      this.penSettingsDrawer.classList.add('hidden');
    } else if (tool === 'eraser') {
      this.viewport.classList.add('eraser-mode');
      this.penSettingsDrawer.classList.add('hidden');
    } else if (tool === 'laser') {
      this.viewport.classList.add('laser-mode');
      this.penSettingsDrawer.classList.add('hidden');
      this.showToast('Laser Highlighter: red dot with fading trail');
    } else if (tool === 'pen' || tool === 'shape') {
      this.penSettingsDrawer.classList.remove('hidden');
    } else {
      this.penSettingsDrawer.classList.add('hidden');
    }
  }

  toggleSidebar() {
    this.sidebar.classList.toggle('collapsed');
    setTimeout(() => {
      this.resizeCanvases();
      this.redrawGrid();
      this.redrawBoard();
    }, 250);
  }

  /* ---------------- Pen Settings Drawer Events ---------------- */
  setupPenDrawerEvents() {
    document.querySelectorAll('.style-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.style-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.penStyle = tab.dataset.style;
      });
    });

    this.penOpacitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.penOpacity = val / 100;
      this.penOpacityVal.innerText = `${val}%`;
    });

    this.penSizeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.penSize = val;
      this.penSizeVal.innerText = `${val}px`;
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.penColor = swatch.dataset.color;
      });
    });
  }

  /* ---------------- Zoom & History Navigation ---------------- */
  setupZoomAndHistoryEvents() {
    this.zoomInBtn.addEventListener('click', () => {
      const center = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 };
      this.zoomAt(center.x, center.y, 1.25);
    });

    this.zoomOutBtn.addEventListener('click', () => {
      const center = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 };
      this.zoomAt(center.x, center.y, 0.8);
    });

    this.zoomResetBtn.addEventListener('click', () => {
      this.scale = 1.0;
      this.applyTransform();
    });

    this.fitViewBtn.addEventListener('click', () => this.fitViewToContent());
    this.undoBtn.addEventListener('click', () => this.undo(true));
    this.redoBtn.addEventListener('click', () => this.redo(true));

    this.gridToggleBtn.addEventListener('click', () => {
      if (this.gridStyle === 'dots') this.gridStyle = 'grid';
      else if (this.gridStyle === 'grid') this.gridStyle = 'none';
      else this.gridStyle = 'dots';
      this.redrawGrid();
      this.showToast(`Grid: ${this.gridStyle}`);
    });

    this.clearCanvasBtn.addEventListener('click', () => {
      if (confirm('Clear the entire board?')) {
        this.clearBoard(true);
      }
    });
  }

  fitViewToContent() {
    if (this.strokes.length === 0 && this.shapes.length === 0 && this.overlayManager.elements.size === 0) {
      this.panX = 0;
      this.panY = 0;
      this.scale = 1.0;
      this.applyTransform();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const stroke of this.strokes) {
      for (const p of stroke.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }

    for (const s of this.shapes) {
      minX = Math.min(minX, s.startX, s.endX);
      minY = Math.min(minY, s.startY, s.endY);
      maxX = Math.max(maxX, s.startX, s.endX);
      maxY = Math.max(maxY, s.startY, s.endY);
    }

    const margin = 80;
    const contentW = (maxX - minX) || 400;
    const contentH = (maxY - minY) || 300;
    const viewW = this.viewport.clientWidth - margin * 2;
    const viewH = this.viewport.clientHeight - margin * 2;

    const fitScale = Math.max(this.minScale, Math.min(1.5, Math.min(viewW / contentW, viewH / contentH)));
    this.scale = fitScale;
    this.panX = (this.viewport.clientWidth - contentW * fitScale) / 2 - minX * fitScale;
    this.panY = (this.viewport.clientHeight - contentH * fitScale) / 2 - minY * fitScale;

    this.applyTransform();
  }

  saveHistorySnapshot() {
    this.undoStack.push({
      strokes: JSON.parse(JSON.stringify(this.strokes)),
      shapes: JSON.parse(JSON.stringify(this.shapes)),
      overlays: this.overlayManager.getAllData()
    });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(broadcast = true) {
    if (this.undoStack.length === 0) return;
    this.redoStack.push({
      strokes: JSON.parse(JSON.stringify(this.strokes)),
      shapes: JSON.parse(JSON.stringify(this.shapes)),
      overlays: this.overlayManager.getAllData()
    });

    const prev = this.undoStack.pop();
    this.strokes = prev.strokes;
    this.shapes = prev.shapes;
    this.overlayManager.clear();
    for (const ov of prev.overlays) {
      this.overlayManager.syncRemoteUpdate('add', ov);
    }
    this.redrawBoard();

    if (broadcast) {
      this.realtime.broadcastUndo();
      if (this.realtime.isHost) {
        this.realtime.broadcastFullState(this.serializeBoard());
      }
    }
  }

  redo(broadcast = true) {
    if (this.redoStack.length === 0) return;
    this.undoStack.push({
      strokes: JSON.parse(JSON.stringify(this.strokes)),
      shapes: JSON.parse(JSON.stringify(this.shapes)),
      overlays: this.overlayManager.getAllData()
    });

    const next = this.redoStack.pop();
    this.strokes = next.strokes;
    this.shapes = next.shapes;
    this.overlayManager.clear();
    for (const ov of next.overlays) {
      this.overlayManager.syncRemoteUpdate('add', ov);
    }
    this.redrawBoard();

    if (broadcast) {
      this.realtime.broadcastRedo();
      if (this.realtime.isHost) {
        this.realtime.broadcastFullState(this.serializeBoard());
      }
    }
  }

  clearBoard(broadcast = true) {
    this.saveHistorySnapshot();
    this.strokes = [];
    this.shapes = [];
    this.overlayManager.clear();
    this.redrawBoard();
    if (broadcast) {
      this.realtime.broadcastClear();
      if (this.realtime.isHost) {
        this.realtime.broadcastFullState(this.serializeBoard());
      }
    }
  }

  /* ---------------- Board Serialization ---------------- */
  serializeBoard() {
    return {
      title: this.boardTitleInput.value,
      strokes: this.strokes,
      shapes: this.shapes,
      overlays: this.overlayManager.getAllData()
    };
  }

  deserializeBoard(data) {
    if (!data) return;
    if (data.title) this.boardTitleInput.value = data.title;
    this.strokes = data.strokes || [];
    this.shapes = data.shapes || [];
    this.overlayManager.clear();
    if (data.overlays) {
      for (const ov of data.overlays) {
        this.overlayManager.syncRemoteUpdate('add', ov);
      }
    }
    this.redrawBoard();
  }

  /* ---------------- Theme & Colors ---------------- */
  setupTheme() {
    const savedTheme = localStorage.getItem('wfi_theme') || 'dark';
    this.setTheme(savedTheme);

    this.themeToggleBtn.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      this.setTheme(next);
    });
  }

  setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('wfi_theme', theme);

    if (theme === 'light' && this.penColor === '#ffffff') {
      this.penColor = '#000000';
      this.updateColorSwatchActive('#000000');
    } else if (theme === 'dark' && this.penColor === '#000000') {
      this.penColor = '#ffffff';
      this.updateColorSwatchActive('#ffffff');
    }

    this.redrawGrid();
    this.redrawBoard();
  }

  updateColorSwatchActive(color) {
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color === color);
    });
  }

  /* ---------------- Share & Join Modal ---------------- */
  setupShareModal() {
    this.shareBtn.addEventListener('click', () => {
      this.shareDialog.showModal();
    });

    this.closeShareModalBtn.addEventListener('click', () => {
      this.shareDialog.close();
    });

    this.shareDialog.addEventListener('click', (e) => {
      if (e.target === this.shareDialog) {
        this.shareDialog.close();
      }
    });

    this.tabHost.addEventListener('click', () => {
      this.tabHost.classList.add('active');
      this.tabJoin.classList.remove('active');
      this.hostView.hidden = false;
      this.joinView.hidden = true;
    });

    this.tabJoin.addEventListener('click', () => {
      this.tabJoin.classList.add('active');
      this.tabHost.classList.remove('active');
      this.hostView.hidden = true;
      this.joinView.hidden = false;
    });

    this.copyCodeBtn.addEventListener('click', () => {
      if (this.realtime.roomCode) {
        navigator.clipboard.writeText(this.realtime.roomCode).then(() => {
          this.showToast(`Copied code: ${this.realtime.roomCode}`);
        });
      }
    });

    this.copyLinkBtn.addEventListener('click', () => {
      if (this.shareLinkInput.value) {
        navigator.clipboard.writeText(this.shareLinkInput.value).then(() => {
          this.showToast('Copied room share link');
        });
      }
    });

    if (this.copyWifiUrlBtn) {
      this.copyWifiUrlBtn.addEventListener('click', () => {
        if (this.wifiUrlInput.value) {
          navigator.clipboard.writeText(this.wifiUrlInput.value).then(() => {
            this.showToast('Copied iPad Wi-Fi URL');
          });
        }
      });
    }

    this.broadcastViewportCheckbox.addEventListener('change', (e) => {
      this.realtime.broadcastViewport = e.target.checked;
    });

    this.connectRoomBtn.addEventListener('click', () => {
      const code = this.joinCodeInput.value.trim();
      if (!code) {
        this.joinStatusMessage.className = 'join-status-message error';
        this.joinStatusMessage.innerText = 'Please enter a valid room code';
        return;
      }
      this.realtime.joinRoom(code);
    });

    this.joinCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.connectRoomBtn.click();
      }
    });
  }

  showToast(text) {
    if (!this.toastNotification) return;
    this.toastNotification.innerText = text;
    this.toastNotification.hidden = false;
    this.toastNotification.style.opacity = '1';
    this.toastNotification.style.transform = 'translateX(-50%) translateY(0)';

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastNotification.style.opacity = '0';
      this.toastNotification.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => { this.toastNotification.hidden = true; }, 250);
    }, 2200);
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(true);
        else this.undo(true);
        return;
      }

      if (e.key === 'p' || e.key === 'P') {
        this.setTool('pen');
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'v' || e.key === 'V') {
        this.setTool('hand');
      } else if (e.key === 'l' || e.key === 'L') {
        this.setTool('laser');
      } else if (e.key === 'e' || e.key === 'E') {
        this.toggleEraserMode();
      } else if (e.key === '+' || e.key === '=') {
        const center = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 };
        this.zoomAt(center.x, center.y, 1.25);
      } else if (e.key === '-' || e.key === '_') {
        const center = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 };
        this.zoomAt(center.x, center.y, 0.8);
      } else if (e.key === '0') {
        this.scale = 1.0;
        this.applyTransform();
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new WhiteboardApp();
});
