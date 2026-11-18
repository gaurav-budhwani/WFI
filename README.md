# Whiteboard

A collaborative whiteboard web application designed for iPad illustration, Apple Pencil writing, and meeting screen sharing with layout inspired by Apple Freeform.

## Features

- Room Code Live Sharing: Generate a room code (for example WFI-842) or copy a direct link so meeting participants can view your illustrations in real time from any browser.
- Freeform Layout: Frosted glass floating pill toolbar, collapsible sidebar, and clean dot grid canvas.
- iPad and Apple Pencil Gestures:
  - 1 finger or Apple Pencil: Draws in pen mode, moves canvas in hand mode.
  - 2 fingers: Pan in all directions (up, down, left, right) and pinch to zoom in any tool mode.
  - Apple Pencil double-tap: Quick double tap toggles between drawing pen and eraser.
- Pen Styles and Customization:
  - Styles: Fountain pen (pressure-sensitive calligraphic line), Normal pen (smooth monoline), Marker (chisel highlighter), and Pencil (graphite texture).
  - Intensity and width: Adjustable opacity (15% to 100%) and stroke size (1 to 40px).
  - Color palette: Monochrome black/white and standard sketching colors.
- Geometric Shapes:
  - Line, Arrow, Rectangle, Rounded Box, Circle/Ellipse, Triangle, and Star with live drag preview.
- Text Boxes and Tables:
  - Add draggable, editable text boxes anywhere on the board.
  - Add interactive grid tables with row and column addition controls.
  - Add sticky notes for quick meeting annotations.
- Black and White Theme:
  - Default dark theme matching Apple dark mode.
  - Single-click toggle to crisp white light mode with automatic stroke contrast adjustment.
- Canvas Zoom and Navigation:
  - 25% to 400% zoom with bottom controls, pinch zoom, 100% reset, and fit to content.
  - Grid style toggle between dots, lines, and plain white/dark canvas.
  - Full undo and redo history.

## Getting Started

### Prerequisites

- Python 3 installed on your computer.
- Modern web browser (Safari on iPad, Chrome, Edge, or Firefox).

### Running Locally

1. On macOS, double-click `start.command` or run:
```bash
python3 app.py
```
2. The terminal displays the local address and the local network address:
```
Local access:   http://localhost:8000
iPad on Wi-Fi:  http://192.168.1.x:8000
```
3. Open the network URL on your iPad using Safari to draw with Apple Pencil.
4. Meeting participants on the same network or remote can join by entering the room code generated in the Share dialog.

### Joining a Session

1. Click Share in the top right corner.
2. Share the generated code (for example `WFI-842`) or copy the direct join link.
3. Participants open the link or click Join Board in the modal and enter the code to watch live strokes and view shifts.

## Project Structure

```
WhiteboardForIpad(WFI)/
├── app.py              # Lightweight local server with IP detection
├── start.command       # Double-clickable macOS launcher
├── start.sh            # Shell launch script
├── web/
│   ├── index.html      # Freeform UI layout
│   ├── style.css       # Clean dark/light theme styling
│   ├── app.js          # Canvas gestures, Apple Pencil, and app controller
│   ├── tools.js        # Pen styles, shapes, and overlay managers
│   ├── realtime.js     # WebRTC live room sharing via PeerJS
│   ├── favicon.svg     # Whiteboard icon
│   └── vendor/
│       └── peerjs.min.js
└── docs/               # GitHub Pages deployment mirror
```

## License

MIT

