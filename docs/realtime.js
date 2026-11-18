/* Whiteboard Realtime Module
   WebRTC Peer-to-Peer live screen illustration sharing via PeerJS.
   Allows host to generate a short Room Code (e.g. WFI-729) or share link;
   participants join to view live drawing strokes, shapes, text, tables, and viewport pan/zoom.
   Zero emojis, clean plain implementation.
*/

export class RealtimeManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.activeHostConnection = null; // if joined as viewer
    this.roomCode = null;
    this.isHost = true;
    this.broadcastViewport = true;
    this.connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
  }

  /**
   * Generate a random friendly Room Code: WFI-###
   */
  static generateRoomCode() {
    const num = Math.floor(100 + Math.random() * 900);
    return `WFI-${num}`;
  }

  static getPeerIdFromCode(code) {
    const clean = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `wfi-collab-${clean.toLowerCase()}`;
  }

  /**
   * Initialize Host mode with a Room Code.
   */
  startHost(customCode = null) {
    this.isHost = true;
    this.roomCode = (customCode || RealtimeManager.generateRoomCode()).toUpperCase();
    const peerId = RealtimeManager.getPeerIdFromCode(this.roomCode);

    this.cleanup();

    try {
      if (typeof window.Peer === 'undefined') {
        this.updateState('error', 'PeerJS library not available.');
        return;
      }

      this.peer = new window.Peer(peerId, {
        debug: 1
      });

      this.peer.on('open', (id) => {
        this.updateState('hosting', `Room ${this.roomCode} ready`);
        if (this.callbacks.onHostReady) {
          this.callbacks.onHostReady(this.roomCode, this.getShareUrl());
        }
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('Peer error:', err);
        if (err.type === 'unavailable-id') {
          // If code collision occurs, pick another code and retry
          const nextCode = RealtimeManager.generateRoomCode();
          this.startHost(nextCode);
        } else {
          this.updateState('error', err.message || 'Connection error');
        }
      });

    } catch (e) {
      console.error('Failed to init host peer:', e);
      this.updateState('error', 'Failed to start live session.');
    }
  }

  /**
   * Handle attendee connecting to host
   */
  handleIncomingConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.updateParticipantCount();

      // Immediately send current board state to new attendee
      if (this.callbacks.getFullBoardState) {
        const fullState = this.callbacks.getFullBoardState();
        conn.send({
          type: 'init',
          roomCode: this.roomCode,
          data: fullState,
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
  }

  /**
   * Join a room as an Attendee/Viewer
   */
  joinRoom(code) {
    if (!code) return;
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    const targetPeerId = RealtimeManager.getPeerIdFromCode(this.roomCode);

    this.cleanup();
    this.updateState('connecting', `Connecting to ${this.roomCode}...`);

    try {
      if (typeof window.Peer === 'undefined') {
        this.updateState('error', 'PeerJS library not loaded');
        return;
      }

      this.peer = new window.Peer(null, { debug: 1 });

      this.peer.on('open', () => {
        const conn = this.peer.connect(targetPeerId, { reliable: true });

        conn.on('open', () => {
          this.activeHostConnection = conn;
          this.updateState('joined', `Connected to ${this.roomCode}`);
          if (this.callbacks.onJoined) {
            this.callbacks.onJoined(this.roomCode);
          }
        });

        conn.on('data', (payload) => {
          this.handleHostMessage(payload);
        });

        conn.on('close', () => {
          this.updateState('disconnected', 'Host disconnected.');
        });

        conn.on('error', (err) => {
          this.updateState('error', 'Failed to connect to host room.');
        });
      });

      this.peer.on('error', (err) => {
        this.updateState('error', `Cannot join: ${err.type || 'Room not found'}`);
      });

    } catch (e) {
      console.error('Failed to join room:', e);
      this.updateState('error', 'Failed to connect.');
    }
  }

  /**
   * Handle real-time messages received from the host
   */
  handleHostMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'init':
        if (this.callbacks.onFullBoardReceived) {
          this.callbacks.onFullBoardReceived(msg.data, msg.viewport);
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
   * Broadcast message to all attendees (if Host)
   */
  broadcast(msg) {
    if (!this.isHost || this.connections.size === 0) return;

    for (const conn of this.connections.values()) {
      if (conn.open) {
        try {
          conn.send(msg);
        } catch (e) {
          console.warn('Broadcast send error:', e);
        }
      }
    }
  }

  broadcastStrokeStart(stroke) {
    this.broadcast({
      type: 'stroke_start',
      stroke
    });
  }

  broadcastStrokePoint(strokeId, point) {
    this.broadcast({
      type: 'stroke_point',
      strokeId,
      point
    });
  }

  broadcastStrokeEnd(strokeId) {
    this.broadcast({
      type: 'stroke_end',
      strokeId
    });
  }

  broadcastShape(shape) {
    this.broadcast({
      type: 'shape_add',
      shape
    });
  }

  broadcastOverlayChange(action, data) {
    this.broadcast({
      type: 'overlay_change',
      action,
      data
    });
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
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (_) {}
    }
    this.connections.clear();

    if (this.activeHostConnection) {
      try { this.activeHostConnection.close(); } catch (_) {}
      this.activeHostConnection = null;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
  }
}
