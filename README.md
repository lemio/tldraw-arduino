# MicroPython Canvas

A shared tldraw canvas for physical computing on an ESP32-S3. You drop
input and output blocks onto the canvas, bind them to pins, and wire them
together. The board's live values show on every collaborator's screen, and
anyone can puppeteer the outputs. The canvas is also a MicroPython program:
the **Code** panel shows that program and can save it to the board, where it
runs as `main.py` with no computer attached.

It builds on [Arduino Action](https://geertroumen.nl/portfolio/index.php?page=action)
(group work, video as context, direct manipulation of the physical world) and
on [MicroPython Visual / Documenter](https://lemio.github.io/Documenter/) (the
value blocks, the serial protocol, and the bundled firmware).

```sh
npm install
npm run dev        # http://localhost:5173 — Chrome or Edge for the board
```

## On the canvas

| | |
|---|---|
| **Digital in / Analog in** | Reads a pin. Shows the value large, with a 10-second sparkline. With no board streaming, you click or drag the block to simulate it. |
| **Digital out / Analog out** | Drives a pin. With no wire attached, you click it (digital) or drag its slider (PWM) to puppeteer it. |
| **Naming** | A new block starts unnamed and opens straight into naming, with a prompt such as *e.g. Door switch*. Name it after the real thing it controls. Click the name of a selected block, double-click the block, or press Enter to rename it. Names become the variable names in `main.py`. |
| **Pins** | Click the GPIO chip to pick the pin on the board itself: the ESP32-S3-DevKitC-1 PCBMAP from the Schematik project (`src/board/`). Rows the block can't use are dimmed, and hovering says why (USB, UART0, PSRAM, power, not analog). Pins in use carry their block's name beside the header. |
| **Compact blocks** | Zooming out below 75 % simplifies blocks the same way shrinking them does. Shrink a block to show less: at 64 px tall only the name and the value, at 32 px only the value (hover for the name and pin). The sparkline stays at every size and is hidden only when the block is too narrow to fit it next to the widest value it could show. When a block is too small for its slider, drag up or down on the sparkline to puppeteer it. Click a digital value to switch it; drag from anywhere to move the block. |
| **Grid** | tldraw's own **Show grid** preference controls it: while it's on (the default; your choice is remembered across rooms), the 16 px grid is drawn, and blocks, cameras and clips snap to it when moved, resized or added. A block is 240 × 96, so ports land on grid lines and aligned blocks get a straight wire. Turn it off and everything moves freely; **Always snap** still aligns to other shapes, as usual in tldraw. |
| **Wires** | Wires are drawn metro-style: horizontal at the ports, only 45° diagonals and verticals in between, rounded bends. A wire whose target sits behind its source loops around. **Preferences → Fan out wires** (off by default, shared by the room) gives each wire leaving the same port its own track, ordered by where it goes. They run exactly one lane apart, through their 45° bends too, until each turns off to its own block. **Bend points:** select a wire and drag any of its bends to fix it in place (it snaps to the grid). Double-click a placed point to remove it, or use **Straighten** in the wire's editor. Badges place themselves along their wire, clear of blocks, bends and each other, and shrink to just their words when space is short. Drag from a port. Compatible ports light up, and the wire snaps within ~44 px. Dropping anywhere on a block also connects. Dropping on empty canvas creates a matching block. **Two HIGH/LOW wires into one digital input** turn into a **Logic** block (OR to start with) placed between them: the existing wire goes to *a*, the new one to *b*. Drag a wire off an input port to move or disconnect it. Esc cancels. |
| **Casts** | Port glyphs show the type: ■ digital, ● analog. When a wire joins two different types, a badge on the wire shows the cast. *HIGH → 100 %* for digital → analog. For analog → digital, a threshold meter set against the live level; drag the badge sideways to move the threshold. |
| **Wire functions** | Click a badge, or the *ƒ* that appears when you hover a plain wire, or double-click a wire, to open its editor. This follows the Logic Definer in Arduino Action. **Follow** or **Toggle** (flip on ↑ rise, ↓ fall or ↕ both). **Threshold**: drag the dashed line on the input trace. **Invert** for digital outputs. **LOW → / HIGH →** levels for analog outputs. **Map** for analog → analog: drag the two ends of the transfer line on the plot (drawn like the gamma chart in Schematik's `learn.html`, with the live value as a dot). **Curve**: Linear, **Gamma** (γ slider; 2.2 makes an LED fade look even to the eye), ease **In**, **Out** or **In-out**. A curved map shows a tiny curve glyph on its badge, and `main.py` applies the same curve. **Into a colour**, pick two colours: a level or number fades from one to the other, and digital switches between them. **Out of a colour**, its brightness counts. Colours always show as colours: swatches and gradients on the badge, colour strips in the traces. The input is drawn above the output it produces, using a recording when one exists. |
| **Camera** | *This computer* streams a webcam. *A phone* shows a QR code that turns the phone into the camera. Everyone in the room sees the video. New cameras go to the bottom layer, so value blocks can sit on top of the video. |
| **Record** | Records every block, plus the selected camera (or the first one), into a clip on the canvas. Drag across a clip to scrub, or press ▶. While scrubbing, every block shows that moment, drawn with a dashed edge. Outputs replay too, with the same dashed edge. They show what the *current* wiring would have done, so a threshold can be tuned against what really happened. Where what feeds an output wasn't recorded (a block added since, or a clip from before in-between steps were kept), the output shows what it actually did. **Live** or Esc goes back. A clip keeps the *in-between* layers too: every logic block's outputs (a variable's count, a Wait's countdown, a gate's result), shown between the inputs and outputs. They start collapsed; click **▸ in between** to unfold them. While scrubbing, logic blocks show their recorded values. **Versions:** every clip also keeps the page as it was recorded. Scrub a clip whose circuit has changed since (other blocks, pins, settings, wire functions or connections) and the canvas switches to **history mode**: the old page, read-only, framed in amber with a bar naming the recording and its time, the recording playing through it. Clips work as version control by example. **Restore this version** makes it the current page again (clips and cameras stay; undo brings today's back); **Back to now** or Esc returns. History mode is per person: nobody else's canvas changes. A clip of the circuit as it still is replays on the live page, so you can keep tuning against it. |
| Everything else | Plain tldraw: pen, shapes, arrows, text, stickies, images. |

The look follows Schematik's circuit drawings (`circuit_minimal.html`). Paper
and near-black ink, IBM Plex Sans for names and IBM Plex Mono for pins and
values. Square boxes with ink outlines, and wires at one weight with square
corners, each net in its own colour. The same URL settings work here:
`?color=multi|single`, `?width=` (line weight in px, default 4) and
`?text=normal|big|giant` (default big). **Preferences → Classic look** (or
`?style=classic`) switches back to the earlier look: rounded white cards and
one accent blue. The choice is per person.

The ink follows Tufte's data-ink idea. A wire is a faint line in its net's
colour until it carries signal. HIGH draws it at full strength, analog sets the
strength, and a colour wire carries its colour. LOW values are grey.

## Assistant

**Assistant** in the top bar opens a chat on the right. Ask for a feature, a
change or a whole program in plain words, such as *"when the door opens, fade
the RGB LED from green to red over ten seconds"*. Claude builds it from blocks
on the canvas: library blocks where they fit, wire functions for thresholds,
maps and fades, and new Python blocks when nothing else does the job. It reads
the canvas first and changes what is there instead of starting over.

When a pin depends on how you will wire your own hardware, the assistant asks:
the pin picker opens on that block with its question above the board, and you
choose the pin there. It uses pins you name yourself, the BOOT button and the
on-board RGB LED without asking.

What it builds is laid out by signal flow beside the existing circuit and
shared with the room like any other edit. Each request is one undo step.

The assistant uses your own Anthropic API key (**Key** in the chat). Requests
go straight from your browser to the Claude API (Claude Opus 5.5, `medium`
effort, with server-side fallback on a declined request) and are billed to
that key. The key is stored only in your browser, never in the room. The
conversation is local too: collaborators see the result, not the chat. The
code is in `src/ai/`.

## Logic blocks

The palette on the left holds everything that can go on the canvas, grouped by
kind: Inputs, Outputs (including the **RGB LED**, the DevKitC-1's WS2812 on
GPIO 38), Time (**Wait**, **Blink**), Variables (**Variable**, **Number**),
Logic (**Logic**, **At least**), Colour (**Colour**, **Rainbow**),
Display (**Gauge**), a **Python block**, and Camera. Click an item to add it
in view, or drag it to where it should go.

**Logic** is one block for every two-input operator. Its behaviour is its
truth table, laid on its side so the rows line up with the ports: *a* and *b*
come in on the left, the output row leaves on the right, and each column is
one case in H and L. A brush marks the case the inputs are in now. Pick AND,
OR, XOR, NAND, NOR or XNOR from the dropdown in the output row, or click any
output to flip it and make your own. Shrunk, the header goes first (the
operator matters more than the name), then the table: at 32 px it shows the
operator and the output. The older **Both** and
**Either** blocks are no longer in the palette, but still work in existing
rooms.

A logic block is MicroPython. While you work, its code runs in the browser on
MicroPython compiled to WebAssembly, the same 1.29 as on the board. The
generated `main.py` runs the very same code on the board. Ports have a type,
and the port glyph shows which:

| Type | Values | Glyph |
| --- | --- | --- |
| digital | 0 or 1 | square |
| analog | 0..1 (shown as %) | circle |
| number | anything | diamond |
| colour | `0xRRGGBB` | rainbow ring |

While nothing is wired to an input, you set its value on the block: typed for
numbers, a switch for digital, a swatch for colour. Buttons such as **Start**
or **+** pulse an input. Anyone in the room can press them.

In a shared room, one browser runs the logic and writes the outputs into the
shared store: the browser the board is plugged into, or else the present
person with the lowest user id. Everyone sees the same values. Block state
(`b.state`, e.g. a Variable's count) lives in the store too. It survives
reloads and carries over into `main.py`.

### Writing a block

**On the canvas.** Add a **Python block**. Give it ports, e.g.
`trigger:digital, seconds:number=5 s`, and an `update(b)`. It runs as you type,
and errors appear on the block. **Copy as library block** gives you the file
for the next step.

**For everyone.** Add a file to `src/blocks/library/<category>/`. It's picked
up automatically, and the category becomes a palette group.

```ts
import { defineBlock } from '../../define'

export default defineBlock({
  id: 'time.wait',            // stable: saved in documents
  category: 'Time',           // palette group
  title: 'Wait',
  description: 'Goes HIGH a set time after it is triggered, like an alarm clock',
  inputs: [
    { id: 'start', type: 'digital' },
    { id: 'seconds', type: 'number', default: 5, unit: 's' },
  ],
  outputs: [{ id: 'done', type: 'digital' }],
  display: 'done',            // shown large, with its sparkline
  controls: [{ input: 'start', label: 'Start' }],
  python: `
def update(b):
    if b.rose('start'):
        b.state['due'] = b.now() + int(b.get('seconds') * 1000)
    due = b.state.get('due')
    b.set('done', 1 if due is not None and b.now() >= due else 0)
`,
})
```

In the Python, `b.get(name)` / `b.set(name, v)` read inputs and write outputs.
`b.rose(name)` / `b.fell(name)` detect edges, and button presses count as
rises. `b.now()` gives milliseconds, and `b.state` is a dict that persists.
`b.rgb(c)` and `b.colour(r, g, b)` convert colours.

Blocks get the three sizes automatically. To draw your own, add `render: { full,
name, value }` with React components; the frame, name and ports stay standard.
Give `fullHeight` if the full drawing needs room (see
`src/blocks/library/display/gauge.tsx`). A library file may be `.tsx`.

## Recording costs

Signals use 8 bits per sample at 20 Hz, about 1.6 kB per block per minute
(colour channels use R, G and B: 4.8 kB; numbers such as a counter use 32-bit
floats: 9.6 kB). Logic block outputs are recorded the same way.
They are stored in the clip, so every collaborator can scrub them. Video is
downscaled to 640 px, 20 fps, about 700 kbit/s (VP9 WebM), roughly 5 MB a
minute. It stays in the recording browser's IndexedDB; collaborators see the
traces and a note saying whose computer holds the video. Clips stop at
2 minutes.

Toggle state lives on the wire. The browser that writes an input value (the
board's host, or whoever clicks a simulated input) also flips the toggle, so
two collaborators never flip it twice.

## Board

**Connect ESP32-S3** opens the browser's serial port picker. If the board has
no MicroPython yet, the app offers to install the bundled
`public/firmware/ESP32_GENERIC_S3-20260824-v1.29.0.bin` (combined image,
offset `0x0`) with esptool-js. If the connection fails, hold BOOT, tap
RESET, then release BOOT. Browsers without Web Serial (Chrome on Android)
fall back to WebUSB, which supports CH340 boards only.

While the canvas is live, `src/device/agent.ts` runs on the board. It is
pasted once through the raw REPL and takes JSON lines on stdin:
`{"c":…}` pin config, `{"w":…}` output values, `{"x":…}` Python from the
console. It replies with `\x1e{json}` telemetry at about 50 Hz. The agent
is never re-sent when blocks change.

While the pin picker is open on a live board, the browser also sends
`{"s":[…]}` to scan the free analog pins (1–18 that no block uses). The board
reads their ADC every cycle, and the picker draws the last three seconds
beside each pin. A few times a second the board also tries each pin with the
internal pull-up and then the pull-down. A pin that follows both has nothing
connected, and its trace stays faint. Every other pin's trace is highlighted.
Closing the picker sends `{"s":[]}`, which puts the scanned pins back to plain
inputs without pulls.

The ADC uses 11 dB attenuation (0–3.1 V) and PWM runs at 1 kHz. Allowed pins
come from the board map. It leaves out GPIO 19/20 (USB), 35–37 (PSRAM) and
43/44 (UART0), and analog inputs only get ADC pins 1–18.

## Collaboration

The `?room=…` part of the URL is the room, so sharing the link (the **Invite**
button copies it) shares the canvas. Sync uses tldraw's `useSyncDemo`, a free
public server. It suits trying things out, not keeping work: rooms are not
private and do not last forever. For real use, run your own
[tldraw sync server](https://tldraw.dev/docs/sync) and switch to `useSync`.

The browser the board is plugged into is its **host**. It writes readings into
the shared store and drives the pins from it, so remote puppeteering needs
nothing extra. Sparkline history is sampled locally by each client.

Video is WebRTC, peer to peer. Only signalling goes through the public PeerJS
broker. Phones need the canvas on an `https://` address (for example a
deployed build or a tunnel) before they can use their camera.

## Deploying

Every push to `main` builds and publishes to GitHub Pages
(`.github/workflows/pages.yml`). The repository's Pages source must be set to
**GitHub Actions**. Serving the branch directly publishes the unbuilt source,
which fails with a 404 on `/src/main.tsx`. Asset paths are relative, so the
build works from any sub-path.

tldraw needs a license key on production domains. Without one the editor shows
for 5 seconds and then disappears, leaving a blank page and a message in the
console. Get a key for the domain from [tldraw.dev](https://tldraw.dev) and
store it as the repository variable `TLDRAW_LICENSE_KEY`. Localhost needs no
key.

## Known limits

- A running **Wait** keeps its due time in that browser's clock. If a different
  browser takes over running the blocks mid-countdown, the countdown is off.
- Only one board per room is expected. Two hosts would both write the
  same input blocks.
- Production deploys of tldraw need a [license key](https://tldraw.dev/pricing).
  Without one, the corner shows the "Get a license" watermark.
- Re-installing over an existing MicroPython can need the BOOT/RESET buttons:
  the S3's native USB switches to a different USB device under MicroPython.

## Layout

```
src/blocks/    logic blocks: definition API, library/, MicroPython runtime + in-browser runner, Python block editor
src/board/     the DevKitC-1 pin map (from the Schematik project)
src/shapes/    IO block, wire + binding, signals & casts, sparkline history, wiring drag
src/device/    Web Serial device, on-board agent, host bridge, main.py codegen, reset lines
src/camera/    camera block, PeerJS streaming, phone page (?cam=…)
src/ui/        top bar, code + console panel, share panel, sparkline
```
