#!/usr/bin/env python3
"""Drive a page in headless Chromium through the DevTools protocol, with the standard library only.

    from cdp import Browser
    with Browser('fft2d/index.html', size=(1400, 900)) as b:
        b.wait('window.__app && __app.ready')
        b.eval('__app.state.n')
        b.drag('#side-k canvas.view', (0.5, 0.5), (0.7, 0.5))   # fractions of the element
        b.screenshot('build/x.png')
        print(b.console)          # console messages and exceptions so far

It serves the repository on a free port, starts Chromium with --remote-debugging-port, and
speaks just enough WebSocket (RFC 6455, client side, unmasked reads, masked writes) to send
commands and read replies.
"""
import base64
import http.server
import json
import os
import shutil
import socket
import socketserver
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass


def _free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class _WebSocket:
    def __init__(self, url):
        assert url.startswith('ws://')
        hostport, path = url[5:].split('/', 1)
        host, port = hostport.split(':')
        self.sock = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n'
               f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.sock.sendall(req.encode())
        resp = b''
        while b'\r\n\r\n' not in resp:
            resp += self.sock.recv(1)
        if b' 101 ' not in resp.split(b'\r\n')[0]:
            raise RuntimeError(resp.decode(errors='replace'))
        self.buf = b''

    def send(self, text):
        data = text.encode()
        head = bytes([0x81])
        n = len(data)
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack('>H', n)
        else:
            head += bytes([0x80 | 127]) + struct.pack('>Q', n)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        parts = []
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            payload = self._read(n)
            parts.append(payload)
            if b0 & 0x80:
                return b''.join(parts).decode()


class Browser:
    def __init__(self, page, size=(1400, 900), chromium=None):
        self.page, self.size = page, size
        self.chromium = chromium or next(shutil.which(c) for c in ('chromium-browser', 'chromium', 'google-chrome') if shutil.which(c))
        self.console = []
        self._id = 0

    def __enter__(self):
        self.server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), _Quiet)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}/'
        port = _free_port()
        self.profile = tempfile.mkdtemp(prefix='bf-cdp-', dir=os.path.join(ROOT, 'build'))
        self.proc = subprocess.Popen(
            [self.chromium, '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
             f'--remote-debugging-port={port}', f'--user-data-dir={self.profile}',
             f'--window-size={self.size[0]},{self.size[1]}', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
                tab = next(t for t in tabs if t['type'] == 'page')
                break
            except Exception:
                time.sleep(0.1)
        self.ws = _WebSocket(tab['webSocketDebuggerUrl'])
        self.call('Runtime.enable')
        self.call('Page.enable')
        self.call('Emulation.setDeviceMetricsOverride', width=self.size[0], height=self.size[1],
                  deviceScaleFactor=1, mobile=False)
        self.goto(self.page)
        return self

    def __exit__(self, *exc):
        try:
            self.proc.terminate()
            self.proc.wait(5)
        except Exception:
            self.proc.kill()
        self.server.shutdown()
        shutil.rmtree(self.profile, ignore_errors=True)

    def call(self, method, **params):
        self._id += 1
        my = self._id
        self.ws.send(json.dumps({'id': my, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == my:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})
            self._event(msg)

    def _event(self, msg):
        m = msg.get('method')
        if m == 'Runtime.consoleAPICalled':
            args = ' '.join(str(a.get('value', a.get('description', ''))) for a in msg['params']['args'])
            self.console.append(f"{msg['params']['type']}: {args}")
        elif m == 'Runtime.exceptionThrown':
            d = msg['params']['exceptionDetails']
            self.console.append('EXCEPTION: ' + d.get('exception', {}).get('description', d.get('text', '')))

    def goto(self, page):
        self.call('Page.navigate', url=self.base + page)
        time.sleep(0.3)

    def eval(self, expr, await_promise=True):
        r = self.call('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=await_promise)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'].get('exception', {}).get('description', str(r['exceptionDetails'])))
        return r['result'].get('value')

    def wait(self, expr, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if self.eval(f'!!({expr})'):
                    return True
            except RuntimeError:
                pass
            time.sleep(0.1)
        raise TimeoutError(expr)

    def sleep(self, s):
        """Let the page run (animation frames) for s seconds, collecting console events."""
        t0 = time.time()
        while time.time() - t0 < s:
            self.eval('0')
            time.sleep(0.05)

    def box(self, selector):
        return self.eval(f'(() => {{ const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }})()')

    def rects(self, selector):
        """The boxes [left, top, width, height] (page coordinates, to 0.1 px) of every visible element
        matching selector, in document order: for checking that readouts keep still."""
        return self.eval(f'''[...document.querySelectorAll({json.dumps(selector)})].map((e) => e.getBoundingClientRect())
            .filter((r) => r.width || r.height)
            .map((r) => [r.left + scrollX, r.top + scrollY, r.width, r.height].map((v) => Math.round(v * 10) / 10))''')

    def steady(self, selector, steps, tol=0.5):
        """Run each of steps (callables that change the numbers shown) and compare the boxes of the
        elements matching selector with those before.  Returns (moves, texts): moves lists
        (step index, element index, [dl, dt, dw, dh]) for every element that moved or changed size by
        more than tol px (or appeared or vanished), texts the distinct texts seen."""
        first = self.rects(selector)
        moves, texts = [], {self.eval(f'[...document.querySelectorAll({json.dumps(selector)})].map((e) => e.textContent).join(" | ")')}
        for i, step in enumerate(steps):
            step()
            now = self.rects(selector)
            texts.add(self.eval(f'[...document.querySelectorAll({json.dumps(selector)})].map((e) => e.textContent).join(" | ")'))
            if len(now) != len(first):
                moves.append((i, -1, [len(first), len(now)]))
                continue
            for k, (a, b) in enumerate(zip(first, now)):
                d = [round(y - x, 1) for x, y in zip(a, b)]
                if max(abs(v) for v in d) > tol:
                    moves.append((i, k, d))
        return moves, texts

    def point(self, selector, frac):
        x, y, w, h = self.box(selector)
        return x + frac[0] * w, y + frac[1] * h

    def mouse(self, kind, x, y, buttons=0, button='none'):
        self.call('Input.dispatchMouseEvent', type=kind, x=x, y=y, buttons=buttons, button=button, clickCount=1 if kind != 'mouseMoved' else 0, pointerType='mouse')

    def click(self, selector, frac=(0.5, 0.5)):
        x, y = self.point(selector, frac)
        self.mouse('mouseMoved', x, y)
        self.mouse('mousePressed', x, y, 1, 'left')
        self.mouse('mouseReleased', x, y, 0, 'left')

    def drag(self, selector, frm, to, steps=12, pause=0.0):
        x0, y0 = self.point(selector, frm)
        x1, y1 = self.point(selector, to)
        self.mouse('mouseMoved', x0, y0)
        self.mouse('mousePressed', x0, y0, 1, 'left')
        for i in range(1, steps + 1):
            self.mouse('mouseMoved', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, 1, 'left')
            if pause:
                time.sleep(pause)
        self.mouse('mouseReleased', x1, y1, 0, 'left')

    def key(self, key, code=None, modifiers=0):
        self.call('Input.dispatchKeyEvent', type='keyDown', key=key, code=code or key, modifiers=modifiers, text=key if len(key) == 1 and not modifiers else '')
        self.call('Input.dispatchKeyEvent', type='keyUp', key=key, code=code or key, modifiers=modifiers)

    def screenshot(self, path, selector=None):
        params = {'format': 'png'}
        if selector:
            x, y, w, h = self.box(selector)
            params['clip'] = {'x': x, 'y': y, 'width': w, 'height': h, 'scale': 1}
        data = self.call('Page.captureScreenshot', **params)['data']
        full = os.path.join(ROOT, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'wb') as f:
            f.write(base64.b64decode(data))
        return full
