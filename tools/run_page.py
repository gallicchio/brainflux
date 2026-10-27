#!/usr/bin/env python3
"""Serve the repository, open a page in headless Chromium, and wait for the page to POST a report.

    tools/run_page.py tests/index.html            # all tests
    tools/run_page.py "tests/index.html?only=fft" # one file
    BROWSER=firefox tools/run_page.py tests/index.html

The page sends its report with fetch('/__report', {method: 'POST', body: text}).  The report is
printed and the exit status is 0 if it contains "SUMMARY: ... 0 failed" (or no SUMMARY at all).
Only the Python standard library and a Chromium binary are needed.
"""
import http.server
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
report = {}
done = threading.Event()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8', 'replace')
        self.send_response(204)
        self.end_headers()
        if self.path.startswith('/__report'):
            report['text'] = body
            done.set()
        elif self.path.startswith('/__log'):
            print(body, flush=True)

    def log_message(self, *args):
        pass


def chromium():
    for name in ('chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable'):
        path = shutil.which(name)
        if path:
            return path
    sys.exit('no Chromium found')


def main():
    page = sys.argv[1] if len(sys.argv) > 1 else 'tests/index.html'
    timeout = float(os.environ.get('TIMEOUT', '600'))
    with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Handler) as server:
        server.daemon_threads = True
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{port}/{page}'
        # A profile inside the repository's build/ (snap-packaged browsers can't see /tmp).
        os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
        profile = tempfile.mkdtemp(prefix='bf-browser-', dir=os.path.join(ROOT, 'build'))
        if os.environ.get('BROWSER') == 'firefox':
            cmd = [shutil.which('firefox'), '--headless', '--new-instance', '--no-remote',
                   '--profile', profile, '--window-size=1400,1000', url]
        else:
            cmd = [chromium(), '--headless', '--disable-gpu', '--no-first-run',
                   '--no-default-browser-check', f'--user-data-dir={profile}',
                   '--window-size=1400,1000', url]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ok = done.wait(timeout)
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
        server.shutdown()
    if not ok:
        print(f'no report from {url} within {timeout:.0f} s')
        return 2
    text = report['text']
    print(text)
    m = re.search(r'SUMMARY: (\d+) passed, (\d+) failed', text)
    return 0 if (m is None or m.group(2) == '0') else 1


if __name__ == '__main__':
    sys.exit(main())
