#!/usr/bin/env python3
"""Exercise the downloadable uploader through a local HTTPS import service."""

import csv
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


SCRIPT = Path(__file__).resolve().parents[1] / "public/static/examples/gitlab/upload-permissions.py"
TOKEN = "fixture-api-key-must-not-appear-in-output"
PREFIX = "/api/v2/organizations/org-fixture/search/sources/source-fixture/permissions/imports"
GROUP_ERROR = "The CSV contains projects outside the configured GitLab group."
REVISION_ERROR = "Permissions changed. Export a new snapshot using the current revision."


class ImportFixture(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        self.handle_request()

    def do_PUT(self):
        self.handle_request()

    def handle_request(self):
        state = self.server.state
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        state["requests"].append((self.command, self.path, raw, time.monotonic()))
        if self.headers.get("X-API-Key") != TOKEN:
            return self.reply(401, {})
        payload = json.loads(raw)
        if self.path == PREFIX:
            state["creates"] += 1
            if state["scenario"] == "redirect":
                self.send_response(307)
                self.send_header("Location", "/trap")
                self.end_headers()
                return
            if state["scenario"] == "create-unavailable":
                return self.reply(503, {"error": {"message": TOKEN}})
            assert self.command == "POST"
            assert payload["provider"] == "gitlab" and payload["expectedRevision"] == 17
            state["manifest"] = payload
            return self.reply(201, {"data": {"id": "import-fixture", "expiresAt": "2099-01-01T00:00:00Z"}})
        if self.path.startswith(PREFIX + "/import-fixture/parts/"):
            assert self.command == "PUT"
            number = int(self.path.rsplit("/", 1)[1])
            if state["scenario"] == "validation-error":
                return self.reply(400, {"error": {
                    "message": GROUP_ERROR + "\nCredential: " + TOKEN,
                    "details": {"csv": "private-csv-contents", "token": TOKEN},
                    "stack": "private-server-stack",
                }})
            if state["scenario"] == "conflict":
                return self.reply(409, {"error": {"message": REVISION_ERROR}})
            attempts = state["attempts"].setdefault(number, [])
            attempts.append(raw)
            if state["scenario"] == "retry" and number == 1 and len(attempts) == 1:
                return self.reply(429, {}, {"Retry-After": "1"})
            if number in state["parts"]:
                assert state["parts"][number] == payload, "Retried a part with different data"
            else:
                assert number == len(state["parts"]), "Skipped or reordered a part"
                expected_field = "userMapping" if number < state["manifest"]["userMapping"]["parts"] else "projectPermissions"
                assert payload["field"] == expected_field
                assert len(payload["content"].encode("utf-8")) <= 1024 * 1024
                rows = list(csv.reader(io.StringIO(payload["content"], newline=""), strict=True))
                if state["scenario"] == "padded-headers":
                    rows = [[cell.strip() for cell in row] for row in rows]
                header = ["user_id", "email"] if expected_field == "userMapping" else ["project_path", "user_id"]
                assert rows[0] == header and 1 <= len(rows) - 1 <= 5000
                state["parts"][number] = payload
                state["rows"][expected_field].extend(rows[1:])
            if state["scenario"] == "retry" and number == 0 and len(attempts) == 1:
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            return self.reply(200, {"data": {"nextPart": number + 1}})
        if self.path == PREFIX + "/import-fixture/complete":
            state["completes"] += 1
            assert payload == {}
            assert len(state["parts"]) == sum(state["manifest"][key]["parts"] for key in state["rows"])
            for key in state["rows"]:
                assert len(state["rows"][key]) == state["manifest"][key]["rowCount"]
            state["published"] = True
            if state["scenario"] == "retry" and state["completes"] == 1:
                return self.reply(503, {"error": {"message": TOKEN}}, {"Retry-After": "0"})
            return self.reply(200, {"data": {"revision": 18}})
        raise AssertionError("Unexpected request or credential redirect")

    def reply(self, status, body, headers=None):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)


def run():
    report_path = Path(os.environ["PERMISSION_UPLOAD_REPORT_PATH"])
    report = {"boundary": "Python CLI subprocess and local HTTPS import service", "checks": []}
    try:
        with tempfile.TemporaryDirectory(prefix="permission-upload-e2e-") as directory:
            root = Path(directory)
            cert, key = root / "cert.pem", root / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                            "-keyout", str(key), "-out", str(cert), "-days", "1",
                            "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"],
                           check=True, capture_output=True)
            server = ThreadingHTTPServer(("127.0.0.1", 0), ImportFixture)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for scenario in ("parts", "record-bound", "padded-headers", "retry", "validation-error", "conflict", "redirect", "create-unavailable",
                                 "malformed", "invalid-utf8", "empty", "too-many-users"):
                    started = time.monotonic()
                    state = {"scenario": scenario, "requests": [], "creates": 0, "completes": 0,
                             "attempts": {}, "parts": {}, "rows": {"userMapping": [], "projectPermissions": []},
                             "published": False}
                    server.state = state
                    users, grants = root / "users.csv", root / "project-permissions.csv"
                    users.write_text('\ufeffuser_id,email\r\n"1","alice@example.com"\r\n\r\n1,alice@example.com\r\n', encoding="utf-8")
                    expected = [["équipe/" + "é" * 600, "1"] for _ in range(6001)] if scenario == "parts" else [["team/project", "1"]] * (6001 if scenario == "record-bound" else 1)
                    with grants.open("w", encoding="utf-8", newline="") as handle:
                        writer = csv.writer(handle, quoting=csv.QUOTE_ALL)
                        writer.writerow(["project_path", "user_id"])
                        writer.writerows(expected)
                    if scenario == "malformed":
                        grants.write_text('project_path,user_id\n"unclosed,1\n')
                    elif scenario == "invalid-utf8":
                        grants.write_bytes(b"project_path,user_id\nteam/\xff,1\n")
                    elif scenario == "empty":
                        grants.write_text("project_path,user_id\n")
                    elif scenario == "too-many-users":
                        with users.open("w") as handle:
                            handle.write("user_id,email\n")
                            for _ in range(500001):
                                handle.write("1,alice@example.com\n")
                    elif scenario == "padded-headers":
                        users.write_text(" user_id , email \n 1 , alice@example.com \n")
                        grants.write_text(" project_path , user_id \n team/project , 1 \n")
                    result = subprocess.run([
                        sys.executable, str(SCRIPT), "--provider", "gitlab", "--expected-revision", "17",
                        "--user-mapping", str(users), "--project-permissions", str(grants),
                    ], capture_output=True, text=True, timeout=45, env={**os.environ,
                        "SIM_BASE_URL": f"https://127.0.0.1:{server.server_port}",
                        "SIM_ORG_ID": "org-fixture", "SIM_SOURCE_ID": "source-fixture",
                        "SIM_API_KEY": TOKEN, "SSL_CERT_FILE": str(cert)})
                    assert TOKEN not in result.stdout + result.stderr, "API key leaked"
                    if scenario in ("parts", "record-bound", "padded-headers", "retry"):
                        assert result.returncode == 0, result.stderr
                        assert json.loads(result.stdout)["revision"] == 18
                        assert state["published"] and state["creates"] == 1
                        assert state["rows"]["projectPermissions"] == expected
                        assert state["rows"]["userMapping"] == [["1", "alice@example.com"]] * (1 if scenario == "padded-headers" else 2)
                        if scenario == "parts":
                            assert state["manifest"]["projectPermissions"]["parts"] > 2, "Did not split on UTF-8 bytes"
                        elif scenario == "record-bound":
                            assert state["manifest"]["projectPermissions"]["parts"] == 2
                        elif scenario == "retry":
                            assert len(state["attempts"][0]) == 2 and len(state["attempts"][1]) == 2
                            assert state["completes"] == 2
                            for attempts in state["attempts"].values():
                                assert len(set(attempts)) == 1, "Retry changed the request body"
                            arrivals = [entry[3] for entry in state["requests"] if entry[1].endswith("/parts/1")]
                            assert arrivals[1] - arrivals[0] >= 1, "Ignored Retry-After"
                    else:
                        assert result.returncode != 0, f"{scenario}: upload unexpectedly succeeded"
                        assert not state["published"] and state["completes"] == 0
                        if scenario in ("malformed", "invalid-utf8", "empty", "too-many-users"):
                            assert not state["requests"], "Started an import before validating both files"
                        elif scenario in ("validation-error", "conflict"):
                            assert len(state["requests"]) == 2, "Retried a conflicting revision or started over"
                            expected_error = GROUP_ERROR if scenario == "validation-error" else REVISION_ERROR
                            assert expected_error in result.stderr, "Discarded Sim's actionable error message"
                            assert ("HTTP 400" if scenario == "validation-error" else "HTTP 409") in result.stderr
                            assert "private-csv-contents" not in result.stderr and "private-server-stack" not in result.stderr
                            assert len(result.stderr.splitlines()) == 1, "Diagnostic contains raw multiline server output"
                        else:
                            assert len(state["requests"]) == 1, "Retried create or followed a redirect"
                    report["checks"].append({"name": scenario, "passed": True,
                                             "seconds": round(time.monotonic() - started, 3)})
                report["passed"] = True
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        raise
    finally:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Passed {len(report['checks'])} uploader checks. Report: {report_path}")


if __name__ == "__main__":
    run()
