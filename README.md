# Whiteboard (WFI)

A collaborative whiteboard web application designed for iPad illustration, Apple Pencil writing, and meeting screen sharing with a layout inspired by Apple Freeform.

Live Web App: https://gaurav-budhwani.github.io/WFI/

## Features

- Multi-User Real-Time Collaboration:
  - Generate a room code (for example `WFI-842`) or copy a direct link so meeting participants can join and collaborate simultaneously.
  - WebRTC mesh powered by Google STUN servers for NAT traversal across corporate firewalls, Wi-Fi networks, and mobile data.
  - Star-topology message fan-out enabling simultaneous drawing, shapes, notes, and laser pointing among multiple users.
  - Color-coded participant presence avatars showing active collaborators in the top bar.

- GoodNotes Style Laser Pointer:
  - Floating glowing red dot cursor with decaying trailing line.
  - Multi-user laser support: each collaborator's pointer displays their assigned color and name tag.

- Freeform Layout:
  - Frosted glass floating pill toolbar, collapsible sidebar, and clean dot grid canvas.
  - Black and white themes matching Apple dark and light modes.

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

- Text Boxes, Tables, and Sticky Notes:
  - Draggable, editable text boxes anywhere on the board.
  - Interactive grid tables with row and column addition controls.
  - Sticky notes for quick meeting annotations.
  - Multi-event deletion via trash icon and Backspace/Delete keyboard shortcut.

- Offline QR Code and Wi-Fi Connect:
  - Built-in QR code generator in the Share dialog for instant iPad camera scanning without typing.
  - Automatic physical Wi-Fi IP address detection for local network collaboration.

- Canvas Zoom and Navigation:
  - 25% to 400% zoom with bottom controls, pinch zoom, 100% reset, and fit to content.
  - Grid style toggle between dots, lines, and plain canvas.
  - Complete undo and redo history.

## Getting Started

### Using Live GitHub Pages

Open https://gaurav-budhwani.github.io/WFI/ directly on your iPad, Mac, or PC. Click Share to generate a room code and invite participants.

### Running Locally

1. On macOS, double-click `start.command` or run:
```bash
python3 app.py
```
2. The terminal displays the local address and the local network address:
```
Local access:   http://localhost:8000
iPad on Wi-Fi:  http://10.1.159.99:8000
```
3. Scan the QR code or open the network URL on your iPad using Safari to draw with Apple Pencil.
4. Meeting participants can join by entering the room code generated in the Share dialog.

## Project Structure

```
WhiteboardForIpad(WFI)/
├── app.py              # Lightweight local server with IP detection
├── start.command       # Double-clickable macOS launcher
├── start.sh            # Shell launch script
├── web/                # Source web application
│   ├── index.html      # Freeform UI layout
│   ├── style.css       # Clean dark/light theme styling
│   ├── app.js          # Canvas gestures, Apple Pencil, and app controller
│   ├── tools.js        # Pen styles, shapes, and overlay managers
│   ├── realtime.js     # WebRTC live room sharing via PeerJS
│   ├── favicon.svg     # Whiteboard icon
│   └── vendor/         # Bundled offline libraries (PeerJS, QRCode)
├── docs/               # GitHub Pages deployment distribution
└── README.md
```

## Architecture

```
                    +---------------------------+
                    |    Host (iPad / Mac)      |
                    +-------------+-------------+
                                  |
              +-------------------+-------------------+
              | WebRTC DataChannel (Google STUN)      |
              v                                       v
+---------------------------+           +---------------------------+
|      Participant A        |           |      Participant B        |
+---------------------------+           +---------------------------+
              ^                                       ^
              +------------- Star Fan-Out ------------+
```

## License

MIT
