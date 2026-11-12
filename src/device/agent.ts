/*
 * The program the browser pastes into the board's raw REPL while the canvas is
 * live. It never needs re-sending when blocks change: the browser sends one
 * JSON object per line on stdin —
 *
 *   {"c": {"4": "di:up", "1": "ai", "13": "do", "12": "ao", "38": "rgb"}}   configure pins
 *   {"w": {"13": 1, "12": 0.42, "38": 16737792}}   drive outputs (0..1; RGB as 0xRRGGBB)
 *   {"x": "print(1 + 1)"}                                     run Python (console)
 *   {"s": [1, 2, 3]}                                          scan free pins ([] stops)
 *
 * — and the board answers with telemetry lines, RS (0x1e) + JSON:
 *
 *   \x1e{"4": 1, "1": 31022}       digital 0/1, analog read_u16() 0..65535
 *
 * While scanning, telemetry also carries "s": the ADC (0..65535) on each
 * scanned pin that no block uses, and "f": the ones that follow the internal
 * pull-up and pull-down, i.e. that nothing is connected to.
 *
 * Anything else the board prints (errors, print() from the console) is a plain
 * line and ends up in the console.
 */
export const TELEMETRY_PREFIX = '\x1e'

export const AGENT_SOURCE = `
import sys, json, time, select
from machine import Pin, ADC, PWM

P = {}
G = {}
S = {}
F = []

def cfg(c):
    for k in P:
        m, o = P[k]
        if m == 'ao':
            try:
                o.deinit()
            except Exception:
                pass
    P.clear()
    for k in c:
        s = c[k].split(':')
        g = int(k)
        m = s[0]
        try:
            if m == 'di':
                pl = s[1] if len(s) > 1 else ''
                if pl == 'up':
                    o = Pin(g, Pin.IN, Pin.PULL_UP)
                elif pl == 'down':
                    o = Pin(g, Pin.IN, Pin.PULL_DOWN)
                else:
                    o = Pin(g, Pin.IN)
            elif m == 'ai':
                try:
                    o = ADC(Pin(g), atten=ADC.ATTN_11DB)
                except TypeError:
                    o = ADC(Pin(g))
                    o.atten(ADC.ATTN_11DB)
            elif m == 'do':
                o = Pin(g, Pin.OUT)
            elif m == 'ao':
                o = PWM(Pin(g), freq=1000, duty_u16=0)
            elif m == 'rgb':
                import neopixel
                o = neopixel.NeoPixel(Pin(g), 1)
            else:
                continue
            P[k] = (m, o)
        except Exception as e:
            print('GPIO', g, ':', e)

def write(w):
    for k in w:
        if k not in P:
            continue
        m, o = P[k]
        v = w[k]
        if m == 'do':
            o.value(1 if v >= 0.5 else 0)
        elif m == 'ao':
            o.duty_u16(int(max(0, min(1, v)) * 65535))
        elif m == 'rgb':
            c = int(v)
            o[0] = ((c >> 16) & 255, (c >> 8) & 255, c & 255)
            o.write()

def adc(g):
    try:
        return ADC(Pin(g), atten=ADC.ATTN_11DB)
    except TypeError:
        o = ADC(Pin(g))
        o.atten(ADC.ATTN_11DB)
        return o

def scan(pins):
    for k in S:
        if k not in P:
            try:
                Pin(int(k), Pin.IN, None)
            except Exception:
                pass
    S.clear()
    F.clear()
    for g in pins:
        k = str(g)
        if k not in P:
            try:
                S[k] = adc(g)
            except Exception:
                pass

def probe():
    F.clear()
    for k in S:
        if k in P:
            continue
        g = int(k)
        try:
            up = Pin(g, Pin.IN, Pin.PULL_UP).value()
            dn = Pin(g, Pin.IN, Pin.PULL_DOWN).value()
            Pin(g, Pin.IN, None)
            if up == 1 and dn == 0:
                F.append(g)
            S[k] = adc(g)
        except Exception:
            pass

def handle(line):
    try:
        c = json.loads(line)
    except Exception:
        return
    if 'c' in c:
        cfg(c['c'])
    if 'w' in c:
        write(c['w'])
    if 's' in c:
        scan(c['s'])
    if 'x' in c:
        try:
            try:
                r = eval(c['x'], G)
                if r is not None:
                    print(repr(r))
            except SyntaxError:
                exec(c['x'], G)
        except Exception as e:
            sys.print_exception(e)

poll = select.poll()
poll.register(sys.stdin, select.POLLIN)
buf = ''
n = 0
while True:
    while poll.poll(0):
        ch = sys.stdin.read(1)
        if ch == '\\n':
            handle(buf)
            buf = ''
        elif ch != '\\r':
            buf += ch
    d = {}
    for k in P:
        m, o = P[k]
        try:
            if m == 'di':
                d[k] = o.value()
            elif m == 'ai':
                d[k] = o.read_u16()
        except Exception:
            pass
    if S:
        n += 1
        if n % 25 == 1:
            probe()
        s = {}
        for k in S:
            if k not in P:
                try:
                    s[k] = S[k].read_u16()
                except Exception:
                    pass
        d['s'] = s
        d['f'] = F
    print('\\x1e' + json.dumps(d))
    time.sleep_ms(20)
`
