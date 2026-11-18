/* Whiteboard Realtime Module
   Dual-channel live screen sharing:
   1. Local Wi-Fi high-speed relay via Server-Sent Events (SSE) and HTTP broadcast
      (Instant sub-10ms latency, zero cloud dependency, works offline on Wi-Fi).
   2. WebRTC peer-to-peer fallback via PeerJS (for remote internet attendees).
   Supports streaming strokes, laser pointer (GoodNotes red dot), shapes, overlays, pan & zoom.
   Zero emojis, clean plain implementation.
*/

export class RealtimeManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection (WebRTC)
    this.eventSource = null; // SSE connection for local Wi-Fi
    this.roomCode = null;
    this.isHost = true;
    this.broadcastViewport = true;
    this.connectionState = 'disconnected';
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.participantCount = 0;
  }

  static generateRoomCode() {
    const num = Math.floor(100 + Math.random() * 900);
    return `WFI-${num}`;
  }

  static getPeerIdFromCode(code) {
    const clean = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `wfi-collab-${clean.toLowerCase()}`;
  }

  /**
   * Start Host Mode
   */
  startHost(customCode = null) {
    this.isHost = true;
    this.roomCode = (customCode || RealtimeManager.generateRoomCode()).toUpperCase();

    this.cleanup();

    if (this.callbacks.onHostReady) {
      this.callbacks.onHostReady(this.roomCode, this.getShareUrl());
    }

    // 1. Connect to Local Server SSE Stream for instant Wi-Fi sync
    this.connectLocalSseStream(this.roomCode);

    // 2. Broadcast initial state to local server
    if (this.callbacks.getFullBoardState) {
      this.postLocalBroadcast({
        type: 'full_state',
        senderId: this.clientId,
        state: this.callbacks.getFullBoardState()
      });
    }

    // 3. Initialize PeerJS WebRTC broker for remote peer discovery
    this.initPeerJsHost();
  }

  initPeerJsHost() {
    try {
      if (typeof window.Peer === 'undefined') return;

      const peerId = RealtimeManager.getPeerIdFromCode(this.roomCode);
      this.peer = new window.Peer(peerId, { debug: 1 });

      this.peer.on('open', () => {
        this.updateState('hosting', `Room ${this.roomCode} live`);
      });

      this.peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.connections.set(conn.peer, conn);
          this.updateParticipantCount();

          // Send full board state to new peer
          if (this.callbacks.getFullBoardState) {
            conn.send({
              type: 'init',
              roomCode: this.roomCode,
              data: this.callbacks.getFullBoardState(),
              viewport: this.callbacks.getViewport ? this.callbacks.getViewport() : null
            });
          }
        });

        conn.on('close', () => {
          this.connections.delete(conn.peer);
          this.updateParticipantCount();
        });

        conn.on('error', () => {
          this.connections.delete(conn.peer);
          this.updateParticipantCount();
        });
      });

      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // If code collision, pick another code
          const nextCode = RealtimeManager.generateRoomCode();
          this.startHost(nextCode);
        }
      });
    } catch (_) {}
  }

  /**
   * Join Room as an Attendee/Viewer
   */
  joinRoom(code) {
    if (!code) return;
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();

    this.cleanup();
    this.updateState('connecting', `Connecting to ${this.roomCode}...`);

    // 1. Fetch current board state from local server if available
    fetch(`/api/room/state?room=${encodeURIComponent(this.roomCode)}`)
      .then(res => res.json())
      .then(state => {
        if (state && (state.strokes || state.shapes || state.overlays)) {
          if (this.callbacks.onFullBoardReceived) {
            this.callbacks.onFullBoardReceived(state, null);
          }
          this.updateState('joined', `Connected to ${this.roomCode}`);
          if (this.callbacks.onJoined) this.callbacks.onJoined(this.roomCode);
        }
      })
      .catch(() => {});

    // 2. Connect to local SSE stream for instant Wi-Fi updates
    this.connectLocalSseStream(this.roomCode);

    // 3. Connect via PeerJS WebRTC as fallback
    this.initPeerJsAttendee();
  }

  initPeerJsAttendee() {
    try {
      if (typeof window.Peer === 'undefined') return;

      const targetPeerId = RealtimeManager.getPeerIdFromCode(this.roomCode);
      this.peer = new window.Peer(null, { debug: 1 });

      this.peer.on('open', () => {
        const conn = this.peer.connect(targetPeerId, { reliable: true });

        conn.on('open', () => {
          this.updateState('joined', `Connected to ${this.roomCode}`);
          if (this.callbacks.onJoined) this.callbacks.onJoined(this.roomCode);
        });

        conn.on('data', (payload) => {
          this.handleIncomingMessage(payload);
        });

        conn.on('close', () => {
          if (this.connectionState !== 'joined') {
            this.updateState('disconnected', 'Host disconnected.');
          }
        });
      });
    } catch (_) {}
  }

  /**
   * Connect to Server-Sent Events (SSE) Stream on local Python server
   */
  connectLocalSseStream(roomCode) {
    try {
      if (this.eventSource) {
        this.eventSource.close();
      }

      this.eventSource = new EventSource(`/api/room/stream?room=${encodeURIComponent(roomCode)}`);

      this.eventSource.onopen = () => {
        if (!this.isHost) {
          this.updateState('joined', `Connected to ${roomCode}`);
          if (this.callbacks.onJoined) this.callbacks.onJoined(roomCode);
        }
      };

      this.eventSource.onmessage = (event) => {
        if (!event.data) return;
        try {
          const msg = JSON.parse(event.data);
          // Ignore own messages
          if (msg.senderId && msg.senderId === this.clientId) return;
          this.handleIncomingMessage(msg);
        } catch (_) {}
      };

      this.eventSource.onerror = () => {
        // SSE error or offline, WebRTC handles fallback
      };
    } catch (_) {}
  }

  /**
   * Process all incoming real-time messages
   */
  handleIncomingMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'init':
      case 'full_state':
        if (this.callbacks.onFullBoardReceived) {
          this.callbacks.onFullBoardReceived(msg.data || msg.state, msg.viewport);
        }
        break;

      case 'stroke_start':
        if (this.callbacks.onRemoteStrokeStart) {
          this.callbacks.onRemoteStrokeStart(msg.stroke);
        }
        break;

      case 'stroke_point':
        if (this.callbacks.onRemoteStrokePoint) {
          this.callbacks.onRemoteStrokePoint(msg.strokeId, msg.point);
        }
        break;

      case 'stroke_end':
        if (this.callbacks.onRemoteStrokeEnd) {
          this.callbacks.onRemoteStrokeEnd(msg.strokeId);
        }
        break;

      case 'laser':
        if (this.callbacks.onRemoteLaser) {
          this.callbacks.onRemoteLaser(msg);
        }
        break;

      case 'shape_add':
        if (this.callbacks.onRemoteShapeAdd) {
          this.callbacks.onRemoteShapeAdd(msg.shape);
        }
        break;

      case 'overlay_change':
        if (this.callbacks.onRemoteOverlayChange) {
          this.callbacks.onRemoteOverlayChange(msg.action, msg.data);
        }
        break;

      case 'clear':
        if (this.callbacks.onRemoteClear) {
          this.callbacks.onRemoteClear();
        }
        break;

      case 'undo':
        if (this.callbacks.onRemoteUndo) {
          this.callbacks.onRemoteUndo();
        }
        break;

      case 'redo':
        if (this.callbacks.onRemoteRedo) {
          this.callbacks.onRemoteRedo();
        }
        break;

      case 'viewport':
        if (this.broadcastViewport && this.callbacks.onRemoteViewport) {
          this.callbacks.onRemoteViewport(msg.viewport);
        }
        break;

      default:
        break;
    }
  }

  /**
   * Broadcast message over both Local Wi-Fi Server and WebRTC DataChannels
   */
  broadcast(msg) {
    msg.senderId = this.clientId;

    // 1. Send via local server HTTP broadcast
    this.postLocalBroadcast(msg);

    // 2. Send via WebRTC DataConnections to connected remote peers
    if (this.connections.size > 0) {
      for (const conn of this.connections.values()) {
        if (conn.open) {
          try { conn.send(msg); } catch (_) {}
        }
      }
    }
  }

  postLocalBroadcast(msg) {
    if (!this.roomCode) return;
    try {
      fetch(`/api/room/broadcast?room=${encodeURIComponent(this.roomCode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      }).catch(() => {});
    } catch (_) {}
  }

  broadcastStrokeStart(stroke) {
    this.broadcast({ type: 'stroke_start', stroke });
  }

  broadcastStrokePoint(strokeId, point) {
    this.broadcast({ type: 'stroke_point', strokeId, point });
  }

  broadcastStrokeEnd(strokeId) {
    this.broadcast({ type: 'stroke_end', strokeId });
  }

  broadcastLaser(laserData) {
    this.broadcast({ type: 'laser', ...laserData });
  }

  broadcastShape(shape) {
    this.broadcast({ type: 'shape_add', shape });
  }

  broadcastOverlayChange(action, data) {
    this.broadcast({ type: 'overlay_change', action, data });
  }

  broadcastClear() {
    this.broadcast({ type: 'clear' });
  }

  broadcastUndo() {
    this.broadcast({ type: 'undo' });
  }

  broadcastRedo() {
    this.broadcast({ type: 'redo' });
  }

  broadcastViewportTransform(panX, panY, scale) {
    if (!this.broadcastViewport) return;
    this.broadcast({
      type: 'viewport',
      viewport: { panX, panY, scale }
    });
  }

  broadcastFullState(state) {
    this.broadcast({
      type: 'full_state',
      state
    });
  }

  getShareUrl() {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${this.roomCode}`;
  }

  updateState(state, message) {
    this.connectionState = state;
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(state, message, this.connections.size);
    }
  }

  updateParticipantCount() {
    const count = this.connections.size;
    if (this.callbacks.onParticipantCountChange) {
      this.callbacks.onParticipantCountChange(count);
    }
  }

  cleanup() {
    if (this.eventSource) {
      try { this.eventSource.close(); } catch (_) {}
      this.eventSource = null;
    }

    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (_) {}
    }
    this.connections.clear();

    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
  }
}
