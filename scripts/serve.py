"""Локальный сервер для разработки.

Отличие от `python3 -m http.server`: файлы отдаются с запретом кэширования,
чтобы после правки кода браузер всегда получал свежую версию.
Запуск из папки проекта:  python3 scripts/serve.py [порт]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 — тише в консоли
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5193
    root = Path(__file__).resolve().parent.parent
    handler = partial(NoCacheHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"http://127.0.0.1:{port}/")
        server.serve_forever()


if __name__ == "__main__":
    main()
