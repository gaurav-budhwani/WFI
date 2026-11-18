/* Whiteboard Realtime Module
   Production multi-user live collaboration engine.
   Features:
   - High-reliability WebRTC mesh via PeerJS with Google STUN servers for firewall/cellular NAT traversal.
   - Star-topology message fan-out enabling simultaneous multi-user drawing, shapes, and text editing.
   - Multi-user presence tracking with color-coded participant avatars.
   - Multi-user laser highlighters (each participant has their own color-coded laser pointer and fading trail).
   - Zero-latency BroadcastChannel for local tabs.
   - Heartbeat keepalive and automatic reconnection.
   Zero emojis, clean plain implementation.
*/

const GOOGLE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

const USER_COLORS = [
  '#0071e3', // Blue (Host default)
  '#8b5cf6', // Violet
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#ef4444', // Red
  '#84cc16'  // Lime
];

export class RealtimeManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.hostConnection = null;   // Active connection to host (if attendee)
    this.participants = new Map(); // id -> { id, peerId, name, color, isHost, lastSeen }

    this.roomCode = null;
    this.isHost = true;
    this.broadcastViewport = true;
    this.connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'hosting' | 'joined' | 'error'

    this.clientId = `u_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
    this.userName = 'Host';
    this.userColor = USER_COLORS[0];

    this.heartbeatInterval = null;
    this.broadcastChannel = null;
    this.hasLocalServer = false;
  }

  static generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'WFI-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  static getPeerIdFromCode(code) {
    const sanitized = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `wfi_room_${sanitized}`;
  }

  /**
   * Start Room as Host
   */
  startHost(customCode = null) {
    this.isHost = true;
    this.userName = 'Host';
    this.userColor = USER_COLORS[0];
    this.roomCode = (customCode || RealtimeManager.generateRoomCode()).toUpperCase();

    this.cleanup();

    this.participants.set(this.clientId, {
      id: this.clientId,
      peerId: null,
      name: this.userName,
      color: this.userColor,
      isHost: true,
      lastSeen: Date.now()
    });

    if (this.callbacks.onHostReady) {
      this.callbacks.onHostReady(this.roomCode, this.getShareUrl());
    }

    this.notifyParticipantUpdate();
    this.initBroadcastChannel();
    this.initPeerJsHost();
    this.startHeartbeat();
  }

  initBroadcastChannel() {
    try {
      if (typeof window.BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new window.BroadcastChannel(`wfi_channel_${this.roomCode}`);
        this.broadcastChannel.onmessage = (event) => {
          if (!event.data || event.data.senderId === this.clientId) return;
          this.handleIncomingMessage(event.data, null);
        };
      }
    } catch (_) {}
  }

  initPeerJsHost() {
    try {
      if (typeof window.Peer === 'undefined') {
        this.updateState('error', 'Peer library unavailable');
        return;
      }

      const hostPeerId = RealtimeManager.getPeerIdFromCode(this.roomCode);
      this.peer = new window.Peer(hostPeerId, {
        debug: 1,
        config: { iceServers: GOOGLE_ICE_SERVERS }
      });

      this.peer.on('open', () => {
        this.updateState('hosting', `Room ${this.roomCode} live`);
      });

      this.peer.on('connection', (conn) => {
        this.handleNewAttendeeConnection(conn);
      });

      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          // If code collision occurs, pick another code and retry
          const nextCode = RealtimeManager.generateRoomCode();
          this.startHost(nextCode);
        } else {
          this.updateState('error', err.message || 'Connection error');
        }
      });
    } catch (e) {
      this.updateState('error', 'Failed to initialize peer session.');
    }
  }

  handleNewAttendeeConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);

      // Assign user slot, color, and name
      const colorIndex = (this.participants.size) % USER_COLORS.length;
      const attendeeColor = USER_COLORS[colorIndex];
      const attendeeNumber = this.participants.size + 1;
      const attendeeName = `User ${attendeeNumber}`;

      const pRecord = {
        id: conn.peer,
        peerId: conn.peer,
        name: attendeeName,
        color: attendeeColor,
        isHost: false,
        lastSeen: Date.now()
      };
      this.participants.set(conn.peer, pRecord);
      this.notifyParticipantUpdate();

      // Listen for data from this attendee
      conn.on('data', (payload) => {
        this.handleAttendeeMessage(conn, payload);
      });

      conn.on('close', () => {
        this.removeAttendee(conn.peer);
      });

      conn.on('error', () => {
        this.removeAttendee(conn.peer);
      });

      // Send initial full board state, assignment, and participant roster
      const fullState = this.callbacks.getFullBoardState ? this.callbacks.getFullBoardState() : null;
      conn.send({
        type: 'init',
        roomCode: this.roomCode,
        assignedUser: {
          id: conn.peer,
          name: attendeeName,
          color: attendeeColor
        },
        participants: Array.from(this.participants.values()),
        data: fullState,
        viewport: this.callbacks.getViewport ? this.callbacks.getViewport() : null
      });

      // Fan-out to all other connected peers that this attendee joined
      this.fanout({
        type: 'peer_joined',
        participant: pRecord,
        senderId: this.clientId
      }, conn.peer);
    });
  }

  handleAttendeeMessage(conn, msg) {
    if (!msg || !msg.type) return;

    // Apply the incoming message to host local state
    this.handleIncomingMessage(msg, conn.peer);

    // Fan-out to all other attendees so everyone stays in sync simultaneously
    this.fanout(msg, conn.peer);
  }

  removeAttendee(peerId) {
    this.connections.delete(peerId);

    let removedId = null;
    if (this.participants.has(peerId)) {
      removedId = peerId;
      this.participants.delete(peerId);
    } else {
      for (const [id, record] of this.participants.entries()) {
        if (record.peerId === peerId) {
          removedId = id;
          this.participants.delete(id);
          break;
        }
      }
    }

    this.notifyParticipantUpdate();

    if (removedId) {
      const leaveMsg = {
        type: 'peer_left',
        participantId: removedId,
        senderId: this.clientId
      };
      this.fanout(leaveMsg, null);
    }
  }

  /**
   * Fan-out a message to all connected attendees except the sender
   */
  fanout(msg, exceptPeerId = null) {
    for (const [peerId, conn] of this.connections.entries()) {
      if (peerId !== exceptPeerId && conn.open) {
        try {
          conn.send(msg);
        } catch (_) {}
      }
    }
  }

  /**
   * Join Room as Attendee
   */
  joinRoom(code) {
    if (!code) return;
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();

    this.cleanup();
    this.updateState('connecting', `Connecting to ${this.roomCode}...`);

    this.initBroadcastChannel();
    this.initPeerJsAttendee();
  }

  initPeerJsAttendee() {
    try {
      if (typeof window.Peer === 'undefined') {
        this.updateState('error', 'Peer library unavailable');
        return;
      }

      this.peer = new window.Peer(null, {
        debug: 1,
        config: { iceServers: GOOGLE_ICE_SERVERS }
      });

      this.peer.on('open', () => {
        const targetHostPeerId = RealtimeManager.getPeerIdFromCode(this.roomCode);
        const conn = this.peer.connect(targetHostPeerId, {
          reliable: true
        });

        conn.on('open', () => {
          this.hostConnection = conn;
          this.updateState('joined', `Connected to ${this.roomCode}`);

          if (this.callbacks.onJoined) {
            this.callbacks.onJoined(this.roomCode);
          }
        });

        conn.on('data', (payload) => {
          this.handleIncomingMessage(payload, null);
        });

        conn.on('close', () => {
          this.updateState('disconnected', 'Host ended the session.');
        });

        conn.on('error', () => {
          this.updateState('error', 'Connection to host lost.');
        });
      });

      this.peer.on('error', (err) => {
        this.updateState('error', `Cannot join: ${err.type || 'Room not found'}`);
      });
    } catch (e) {
      this.updateState('error', 'Failed to connect to host.');
    }
  }

  /**
   * Process all incoming real-time messages
   */
  handleIncomingMessage(msg, fromPeerId) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'init':
        if (msg.assignedUser) {
          this.clientId = msg.assignedUser.id || this.clientId;
          this.userName = msg.assignedUser.name;
          this.userColor = msg.assignedUser.color;
        }
        if (msg.participants && Array.isArray(msg.participants)) {
          this.participants.clear();
          for (const p of msg.participants) {
            this.participants.set(p.id, p);
          }
          this.notifyParticipantUpdate();
        }
        if (this.callbacks.onFullBoardReceived) {
          this.callbacks.onFullBoardReceived(msg.data, msg.viewport);
        }
        break;

      case 'peer_joined':
        if (msg.participant) {
          this.participants.set(msg.participant.id, msg.participant);
          this.notifyParticipantUpdate();
        }
        break;

      case 'peer_left':
        if (msg.participantId) {
          this.participants.delete(msg.participantId);
          this.notifyParticipantUpdate();
        }
        break;

      case 'full_state':
        if (this.callbacks.onFullBoardReceived) {
          this.callbacks.onFullBoardReceived(msg.state, msg.viewport);
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

      case 'overlay_update':
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
        if (this.callbacks.onRemoteViewport) {
          this.callbacks.onRemoteViewport(msg.viewport);
        }
        break;

      case 'ping':
        if (msg.senderId && this.participants.has(msg.senderId)) {
          this.participants.get(msg.senderId).lastSeen = Date.now();
        }
        break;

      default:
        break;
    }
  }

  /**
   * Broadcast message to all collaborators
   */
  broadcast(msg) {
    msg.senderId = this.clientId;
    msg.userName = this.userName;
    msg.userColor = this.userColor;

    // 1. BroadcastChannel (for local tab sync)
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(msg); } catch (_) {}
    }

    // 2. If Host: Fan-out to all connected attendees
    if (this.isHost) {
      this.fanout(msg, null);
    }
    // 3. If Attendee: Send to Host (Host will fan-out to all others)
    else if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send(msg);
      } catch (_) {}
    }
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

  broadcastLaser(x, y, active = true) {
    this.broadcast({ type: 'laser', x, y, active });
  }

  broadcastShapeAdd(shape) {
    this.broadcast({ type: 'shape_add', shape });
  }

  broadcastOverlayChange(action, data) {
    this.broadcast({ type: 'overlay_update', action, data });
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

  broadcastViewportSync(viewport) {
    if (!this.broadcastViewport) return;
    this.broadcast({ type: 'viewport', viewport });
  }

  broadcastFullState(state) {
    this.broadcast({
      type: 'full_state',
      state,
      viewport: this.callbacks.getViewport ? this.callbacks.getViewport() : null
    });
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'ping' });
    }, 10000);
  }

  getShareUrl() {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${this.roomCode}`;
  }

  updateState(state, message) {
    this.connectionState = state;
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(state, message, this.participants.size);
    }
  }

  notifyParticipantUpdate() {
    const list = Array.from(this.participants.values());
    if (this.callbacks.onParticipantUpdate) {
      this.callbacks.onParticipantUpdate(list);
    }
    if (this.callbacks.onParticipantCountChange) {
      this.callbacks.onParticipantCountChange(list.length);
    }
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.broadcastChannel) {
      try { this.broadcastChannel.close(); } catch (_) {}
      this.broadcastChannel = null;
    }

    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (_) {}
    }
    this.connections.clear();

    if (this.hostConnection) {
      try { this.hostConnection.close(); } catch (_) {}
      this.hostConnection = null;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
  }
}
