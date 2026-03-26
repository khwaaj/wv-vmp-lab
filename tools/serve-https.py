#!/usr/bin/env python3

import http.server
import ssl
import argparse
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Simple HTTPS static file server")

    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Directory to serve (default: current directory)"
    )

    parser.add_argument(
        "--port",
        type=int,
        default=8443,
        help="Port to serve on (default: 8443)"
    )

    parser.add_argument(
        "--cert",
        default=None,
        help="Path to TLS certificate (default: script directory / localhost.pem)"
    )

    parser.add_argument(
        "--key",
        default=None,
        help="Path to TLS key (default: script directory / localhost-key.pem)"
    )

    args = parser.parse_args()

    # 📍 Resolve script directory
    script_dir = Path(__file__).resolve().parent

    # 📍 Resolve cert/key defaults
    cert_path = Path(args.cert) if args.cert else script_dir / "localhost.pem"
    key_path = Path(args.key) if args.key else script_dir / "localhost-key.pem"

    cert_path = cert_path.resolve()
    key_path = key_path.resolve()

    if not cert_path.exists():
        raise SystemExit(f"Certificate not found: {cert_path}")

    if not key_path.exists():
        raise SystemExit(f"Key not found: {key_path}")

    # 📍 Serve directory
    serve_dir = Path(args.directory).resolve()

    if not serve_dir.exists():
        raise SystemExit(f"Directory does not exist: {serve_dir}")

    os.chdir(serve_dir)

    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(("localhost", args.port), handler)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))

    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print(f"Serving directory : {serve_dir}")
    print(f"Using cert       : {cert_path}")
    print(f"Using key        : {key_path}")
    print(f"https://localhost:{args.port}")

    httpd.serve_forever()


if __name__ == "__main__":
    main()