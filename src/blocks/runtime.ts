/*
 * The `b` every block's update(b) receives. One definition, used twice: by the
 * in-browser runner (MicroPython on WebAssembly) and in the generated main.py,
 * so a block behaves the same on the canvas and on the board.
 */
export const PY_RUNTIME = `
import time

class Block:
    def __init__(self, update, setup=None):
        self._update = update
        self._setup = setup
        self._started = False
        self.inputs = {}
        self.presses = {}
        self.state = {}
        self.out = {}
        self._prev = {}
        self._prev_presses = {}

    def get(self, name, default=0):
        v = self.inputs.get(name)
        return default if v is None else v

    def set(self, name, value):
        self.out[name] = value

    def now(self):
        return time.ticks_ms()

    def rose(self, name):
        if self.presses.get(name, 0) != self._prev_presses.get(name, 0):
            return True
        return self.get(name) >= 0.5 and self._prev.get(name, 0) < 0.5

    def fell(self, name):
        return self.get(name) < 0.5 and self._prev.get(name, 0) >= 0.5

    def rgb(self, c):
        c = int(c)
        return ((c >> 16) & 255, (c >> 8) & 255, c & 255)

    def colour(self, r, g, b):
        return (int(r) & 255) << 16 | (int(g) & 255) << 8 | (int(b) & 255)

    def step(self):
        if not self._started:
            # The first run sees no edges: nothing fires just because it started.
            self._started = True
            self._prev = dict(self.inputs)
            self._prev_presses = dict(self.presses)
            if self._setup:
                self._setup(self)
        self._update(self)
        self._prev = dict(self.inputs)
        self._prev_presses = dict(self.presses)
`
