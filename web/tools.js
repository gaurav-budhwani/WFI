/* Whiteboard Tools Module
   Stroke renderers (Fountain, Normal, Marker, Pencil, Eraser),
   Shape renderers (Line, Arrow, Rectangle, Rounded Box, Circle, Triangle, Star),
   and DOM overlay elements (Text Box, Table, Sticky Note).
   Zero emojis, clean plain implementation.
*/

export class StrokeRenderer {
  /**
   * Render a complete stroke on a 2D canvas context in world coordinates.
   */
  static renderStroke(ctx, stroke) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = stroke.size || 24;
      this.drawMonoline(ctx, stroke.points);
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = 'source-over';
    const opacity = typeof stroke.opacity === 'number' ? stroke.opacity : 1;
    ctx.strokeStyle = stroke.color || '#ffffff';
    ctx.fillStyle = stroke.color || '#ffffff';

    const style = stroke.style || 'normal';

    switch (style) {
      case 'fountain':
        this.drawFountainPen(ctx, stroke, opacity);
        break;
      case 'marker':
        this.drawMarker(ctx, stroke, opacity);
        break;
      case 'pencil':
        this.drawPencil(ctx, stroke, opacity);
        break;
      case 'normal':
      default:
        this.drawNormalPen(ctx, stroke, opacity);
        break;
    }

    ctx.restore();
  }

  /**
   * Normal Pen: smooth quadratic bezier interpolation with consistent stroke width.
   */
  static drawNormalPen(ctx, stroke, opacity) {
    ctx.globalAlpha = opacity;
    ctx.lineWidth = stroke.size || 4;
    this.drawMonoline(ctx, stroke.points);
  }

  static drawMonoline(ctx, points) {
    if (points.length === 1) {
      const p = points[0];
      ctx.beginPath();
      ctx.arc(p.x, p.y, (ctx.lineWidth || 4) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  /**
   * Fountain Pen: calligraphic stroke responsive to pressure, velocity, and nib angle.
   */
  static drawFountainPen(ctx, stroke, opacity) {
    ctx.globalAlpha = opacity;
    const baseSize = stroke.size || 4;
    const points = stroke.points;

    if (points.length === 1) {
      const p = points[0];
      const radius = Math.max(1, baseSize * (p.pressure || 0.5));
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Calligraphic nib angle (~35 degrees)
    const nibAngle = (35 * Math.PI) / 180;
    const cosAngle = Math.cos(nibAngle);
    const sinAngle = Math.sin(nibAngle);

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy) || 1;
      const dirX = dx / dist;
      const dirY = dy / dist;

      // Angle factor between movement direction and nib angle
      const angleDiff = Math.abs(dirX * cosAngle + dirY * sinAngle);
      const nibMod = 0.4 + 0.8 * (1 - angleDiff);

      // Pressure modulation
      const press1 = typeof p1.pressure === 'number' && p1.pressure > 0 ? p1.pressure : 0.5;
      const press2 = typeof p2.pressure === 'number' && p2.pressure > 0 ? p2.pressure : 0.5;

      const w1 = Math.max(1, baseSize * (0.5 + 0.9 * press1) * nibMod);
      const w2 = Math.max(1, baseSize * (0.5 + 0.9 * press2) * nibMod);

      // Draw tapered segment
      const perpX = -dirY;
      const perpY = dirX;

      ctx.beginPath();
      ctx.moveTo(p1.x - perpX * (w1 / 2), p1.y - perpY * (w1 / 2));
      ctx.lineTo(p1.x + perpX * (w1 / 2), p1.y + perpY * (w1 / 2));
      ctx.lineTo(p2.x + perpX * (w2 / 2), p2.y + perpY * (w2 / 2));
      ctx.lineTo(p2.x - perpX * (w2 / 2), p2.y - perpY * (w2 / 2));
      ctx.closePath();
      ctx.fill();

      // Cap
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, w2 / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Marker / Highlighter: semi-transparent wide stroke with chisel look.
   */
  static drawMarker(ctx, stroke, opacity) {
    ctx.globalAlpha = Math.min(0.45, opacity * 0.4);
    ctx.lineWidth = Math.max(14, (stroke.size || 4) * 3);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'bevel';
    this.drawMonoline(ctx, stroke.points);
  }

  /**
   * Pencil: graphite texture with slight stippled grain and pressure sensitivity.
   */
  static drawPencil(ctx, stroke, opacity) {
    const points = stroke.points;
    const baseSize = Math.max(1, (stroke.size || 3) * 0.9);
    ctx.globalAlpha = opacity * 0.7;

    ctx.lineWidth = baseSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.drawMonoline(ctx, points);

    // Subtle graphite grain overlay
    ctx.globalAlpha = opacity * 0.25;
    for (let i = 0; i < points.length; i += 2) {
      const p = points[i];
      const r = baseSize * (0.8 + 0.4 * (p.pressure || 0.5));
      const jitterX = (Math.sin(i * 997) * r) * 0.4;
      const jitterY = (Math.cos(i * 991) * r) * 0.4;

      ctx.beginPath();
      ctx.arc(p.x + jitterX, p.y + jitterY, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Render an interactive shape on canvas.
   */
  static renderShape(ctx, shape) {
    if (!shape) return;

    ctx.save();
    ctx.strokeStyle = shape.color || '#ffffff';
    ctx.fillStyle = shape.fillColor || 'transparent';
    ctx.lineWidth = shape.size || 3;
    ctx.globalAlpha = typeof shape.opacity === 'number' ? shape.opacity : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const { startX, startY, endX, endY } = shape;
    const width = endX - startX;
    const height = endY - startY;

    switch (shape.shapeType) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        break;

      case 'arrow':
        this.drawArrow(ctx, startX, startY, endX, endY, shape.size || 3);
        break;

      case 'rect':
        ctx.beginPath();
        ctx.rect(startX, startY, width, height);
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
        break;

      case 'rounded-rect':
        this.drawRoundedRect(ctx, startX, startY, width, height, 16);
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
        break;

      case 'circle':
        ctx.beginPath();
        const rx = Math.abs(width) / 2;
        const ry = Math.abs(height) / 2;
        const cx = startX + width / 2;
        const cy = startY + height / 2;
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
        break;

      case 'triangle':
        this.drawTriangle(ctx, startX, startY, endX, endY);
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
        break;

      case 'star':
        this.drawStar(ctx, startX, startY, endX, endY);
        if (shape.fillColor) ctx.fill();
        ctx.stroke();
        break;

      default:
        break;
    }

    ctx.restore();
  }

  static drawArrow(ctx, x1, y1, x2, y2, strokeSize) {
    const headLength = Math.max(12, strokeSize * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Arrow head
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  static drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, radius);
    const x1 = Math.min(x, x + width);
    const y1 = Math.min(y, y + height);
    const w = Math.abs(width);
    const h = Math.abs(height);

    ctx.beginPath();
    ctx.moveTo(x1 + r, y1);
    ctx.lineTo(x1 + w - r, y1);
    ctx.quadraticCurveTo(x1 + w, y1, x1 + w, y1 + r);
    ctx.lineTo(x1 + w, y1 + h - r);
    ctx.quadraticCurveTo(x1 + w, y1 + h, x1 + w - r, y1 + h);
    ctx.lineTo(x1 + r, y1 + h);
    ctx.quadraticCurveTo(x1, y1 + h, x1, y1 + h - r);
    ctx.lineTo(x1, y1 + r);
    ctx.quadraticCurveTo(x1, y1, x1 + r, y1);
    ctx.closePath();
  }

  static drawTriangle(ctx, x1, y1, x2, y2) {
    const topX = x1 + (x2 - x1) / 2;
    const topY = y1;

    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x1, y2);
    ctx.closePath();
  }

  static drawStar(ctx, x1, y1, x2, y2) {
    const cx = x1 + (x2 - x1) / 2;
    const cy = y1 + (y2 - y1) / 2;
    const outerR = Math.max(1, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2);
    const innerR = outerR * 0.42;
    const points = 5;

    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/**
 * Overlay Manager handles interactive DOM objects (Text boxes, Tables, Sticky notes)
 * positioned in world space and transformed accurately as the canvas pans and zooms.
 */
export class OverlayManager {
  constructor(overlayContainer, callbacks) {
    this.container = overlayContainer;
    this.callbacks = callbacks || {};
    this.elements = new Map(); // id -> { element, data }
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
  }

  setTransform(panX, panY, scale) {
    this.panX = panX;
    this.panY = panY;
    this.scale = scale;
    this.updateAllPositions();
  }

  updateAllPositions() {
    for (const [id, record] of this.elements.entries()) {
      this.updateElementPosition(record.element, record.data);
    }
  }

  updateElementPosition(el, data) {
    const screenX = data.x * this.scale + this.panX;
    const screenY = data.y * this.scale + this.panY;
    el.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) scale(${this.scale})`;
  }

  /**
   * Add a Text Box
   */
  addTextBox(data, broadcast = true) {
    const id = data.id || `text_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const textData = {
      id,
      type: 'text',
      x: data.x,
      y: data.y,
      text: data.text || 'Text',
      fontSize: data.fontSize || 18,
      color: data.color || '#ffffff'
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-element drag-handle';
    wrapper.dataset.id = id;

    // Mini element toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'element-toolbar';
    toolbar.innerHTML = `
      <button type="button" class="element-action-btn delete" data-action="delete" title="Delete">Delete</button>
    `;

    const textBox = document.createElement('div');
    textBox.className = 'canvas-text-box';
    textBox.contentEditable = 'true';
    textBox.spellcheck = false;
    textBox.innerText = textData.text;
    textBox.style.color = textData.color;
    textBox.style.fontSize = `${textData.fontSize}px`;

    wrapper.appendChild(toolbar);
    wrapper.appendChild(textBox);
    this.container.appendChild(wrapper);

    this.elements.set(id, { element: wrapper, data: textData });
    this.updateElementPosition(wrapper, textData);

    this.attachElementHandlers(wrapper, textData, textBox);

    if (broadcast && this.callbacks.onElementChange) {
      this.callbacks.onElementChange('add', textData);
    }

    // Auto-focus if newly created
    if (!data.id) {
      setTimeout(() => {
        textBox.focus();
        document.execCommand('selectAll', false, null);
      }, 50);
    }

    return textData;
  }

  /**
   * Add a Table
   */
  addTable(data, broadcast = true) {
    const id = data.id || `table_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const rows = data.rows || 3;
    const cols = data.cols || 3;
    const tableMatrix = data.data || Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));

    const tableData = {
      id,
      type: 'table',
      x: data.x,
      y: data.y,
      rows,
      cols,
      data: tableMatrix
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-element drag-handle';
    wrapper.dataset.id = id;

    const innerWrapper = document.createElement('div');
    innerWrapper.className = 'canvas-table-wrapper';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'element-toolbar';
    toolbar.innerHTML = `
      <button type="button" class="element-action-btn delete" data-action="delete" title="Delete Table">Delete</button>
    `;

    // Table element
    const table = document.createElement('table');
    table.className = 'canvas-table';

    this.renderTableBody(table, tableData);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'table-controls';
    controls.innerHTML = `
      <button type="button" class="table-btn" data-action="add-row">+ Row</button>
      <button type="button" class="table-btn" data-action="add-col">+ Col</button>
    `;

    innerWrapper.appendChild(toolbar);
    innerWrapper.appendChild(table);
    innerWrapper.appendChild(controls);
    wrapper.appendChild(innerWrapper);
    this.container.appendChild(wrapper);

    this.elements.set(id, { element: wrapper, data: tableData });
    this.updateElementPosition(wrapper, tableData);

    this.attachTableHandlers(wrapper, tableData, table);

    if (broadcast && this.callbacks.onElementChange) {
      this.callbacks.onElementChange('add', tableData);
    }

    return tableData;
  }

  renderTableBody(table, tableData) {
    table.innerHTML = '';
    const tbody = document.createElement('tbody');

    for (let r = 0; r < tableData.rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < tableData.cols; c++) {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.innerText = (tableData.data[r] && tableData.data[r][c]) || '';
        td.dataset.row = r;
        td.dataset.col = c;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  /**
   * Add a Sticky Note
   */
  addNote(data, broadcast = true) {
    const id = data.id || `note_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const noteData = {
      id,
      type: 'note',
      x: data.x,
      y: data.y,
      text: data.text || '',
      color: data.color || '#fef08a'
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-element drag-handle';
    wrapper.dataset.id = id;

    const toolbar = document.createElement('div');
    toolbar.className = 'element-toolbar';
    toolbar.innerHTML = `
      <button type="button" class="element-action-btn delete" data-action="delete" title="Delete Note">Delete</button>
    `;

    const note = document.createElement('div');
    note.className = 'canvas-sticky-note';
    note.style.backgroundColor = noteData.color;

    const textarea = document.createElement('textarea');
    textarea.className = 'sticky-content';
    textarea.placeholder = 'Type a note...';
    textarea.value = noteData.text;

    note.appendChild(textarea);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(note);
    this.container.appendChild(wrapper);

    this.elements.set(id, { element: wrapper, data: noteData });
    this.updateElementPosition(wrapper, noteData);

    this.attachNoteHandlers(wrapper, noteData, textarea);

    if (broadcast && this.callbacks.onElementChange) {
      this.callbacks.onElementChange('add', noteData);
    }

    return noteData;
  }

  attachElementHandlers(wrapper, data, textBox) {
    // Delete action
    wrapper.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeElement(data.id, true);
    });

    // Content input
    textBox.addEventListener('input', () => {
      data.text = textBox.innerText;
      if (this.callbacks.onElementChange) {
        this.callbacks.onElementChange('update', data);
      }
    });

    // Draggable handling in world space
    this.makeDraggable(wrapper, data);
  }

  attachTableHandlers(wrapper, data, table) {
    wrapper.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeElement(data.id, true);
    });

    wrapper.querySelector('[data-action="add-row"]').addEventListener('click', (e) => {
      e.stopPropagation();
      data.rows += 1;
      data.data.push(Array.from({ length: data.cols }, () => ''));
      this.renderTableBody(table, data);
      if (this.callbacks.onElementChange) {
        this.callbacks.onElementChange('update', data);
      }
    });

    wrapper.querySelector('[data-action="add-col"]').addEventListener('click', (e) => {
      e.stopPropagation();
      data.cols += 1;
      data.data.forEach(row => row.push(''));
      this.renderTableBody(table, data);
      if (this.callbacks.onElementChange) {
        this.callbacks.onElementChange('update', data);
      }
    });

    table.addEventListener('input', (e) => {
      const td = e.target.closest('td');
      if (td) {
        const r = parseInt(td.dataset.row, 10);
        const c = parseInt(td.dataset.col, 10);
        if (data.data[r]) {
          data.data[r][c] = td.innerText;
          if (this.callbacks.onElementChange) {
            this.callbacks.onElementChange('update', data);
          }
        }
      }
    });

    this.makeDraggable(wrapper, data);
  }

  attachNoteHandlers(wrapper, data, textarea) {
    wrapper.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeElement(data.id, true);
    });

    textarea.addEventListener('input', () => {
      data.text = textarea.value;
      if (this.callbacks.onElementChange) {
        this.callbacks.onElementChange('update', data);
      }
    });

    this.makeDraggable(wrapper, data);
  }

  makeDraggable(wrapper, data) {
    let isDragging = false;
    let startScreenX = 0;
    let startScreenY = 0;
    let originDataX = 0;
    let originDataY = 0;

    const onPointerDown = (e) => {
      // Don't drag if interacting with contentEditable or inputs
      if (e.target.isContentEditable || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
        return;
      }
      isDragging = true;
      startScreenX = e.clientX;
      startScreenY = e.clientY;
      originDataX = data.x;
      originDataY = data.y;
      wrapper.setPointerCapture(e.pointerId);
      e.stopPropagation();
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - startScreenX) / this.scale;
      const dy = (e.clientY - startScreenY) / this.scale;
      data.x = originDataX + dx;
      data.y = originDataY + dy;
      this.updateElementPosition(wrapper, data);
      e.stopPropagation();
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}
      if (this.callbacks.onElementChange) {
        this.callbacks.onElementChange('update', data);
      }
      e.stopPropagation();
    };

    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove);
    wrapper.addEventListener('pointerup', onPointerUp);
    wrapper.addEventListener('pointercancel', onPointerUp);
  }

  removeElement(id, broadcast = true) {
    const record = this.elements.get(id);
    if (record) {
      record.element.remove();
      this.elements.delete(id);
      if (broadcast && this.callbacks.onElementChange) {
        this.callbacks.onElementChange('delete', { id });
      }
    }
  }

  clear() {
    for (const [id, record] of this.elements.entries()) {
      record.element.remove();
    }
    this.elements.clear();
  }

  getAllData() {
    const result = [];
    for (const record of this.elements.values()) {
      result.push(record.data);
    }
    return result;
  }

  syncRemoteUpdate(action, data) {
    if (action === 'delete') {
      this.removeElement(data.id, false);
      return;
    }

    if (action === 'add') {
      if (data.type === 'text') this.addTextBox(data, false);
      else if (data.type === 'table') this.addTable(data, false);
      else if (data.type === 'note') this.addNote(data, false);
      return;
    }

    if (action === 'update') {
      const record = this.elements.get(data.id);
      if (record) {
        Object.assign(record.data, data);
        this.updateElementPosition(record.element, record.data);

        if (data.type === 'text') {
          const textBox = record.element.querySelector('.canvas-text-box');
          if (textBox && textBox.innerText !== data.text) {
            textBox.innerText = data.text;
          }
        } else if (data.type === 'table') {
          const table = record.element.querySelector('.canvas-table');
          if (table) this.renderTableBody(table, record.data);
        } else if (data.type === 'note') {
          const textarea = record.element.querySelector('.sticky-content');
          if (textarea && textarea.value !== data.text) {
            textarea.value = data.text;
          }
        }
      } else {
        // If not found, add it
        this.syncRemoteUpdate('add', data);
      }
    }
  }
}
