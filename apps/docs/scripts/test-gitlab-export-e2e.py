#!/usr/bin/env python3
"""Exercise the downloadable exporter over HTTPS, in a separate process."""

import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


SCRIPT = Path(__file__).resolve().parents[1] / "public/static/examples/gitlab/export-permissions.py"
TOKEN = "fixture-token-must-not-appear-in-output"
SIM_ROOT = Path(__file__).resolve().parents[2] / "sim"


def member(user_id, **overrides):
    return {"id": user_id, "state": "active", "access_level": 30,
            "expires_at": None, **overrides}


class GitLabFixture(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *_args):
        pass

    def do_GET(self):
        parsed = urlsplit(self.path)
        scenario, endpoint = parsed.path.lstrip("/").split("/api/v4/", 1)
        self.calls.append((scenario, endpoint, parse_qs(parsed.query), time.monotonic()))
        if self.headers.get("PRIVATE-TOKEN") != TOKEN:
            self.reply(401, {"message": "Missing token"})
            return
        if scenario == "denied":
            self.reply(403, {"message": TOKEN})
            return
        if endpoint in ("projects/engineering%2Fplatform", "projects/91"):
            if scenario == "redirect":
                self.reply(302, {}, {"Location": "/redirect/api/v4/trap"})
            else:
                self.reply(200, {"id": 91, "path_with_namespace": "engineering/platform",
                                 "repository_access_level": "disabled" if scenario == "issues-only" else "enabled",
                                 "issues_access_level": "enabled", "wiki_access_level": "enabled"})
        elif endpoint == "projects/91/members/all":
            page = parse_qs(parsed.query).get("page", ["1"])[0]
            total = "11" if scenario in ("truncated-membership", "changing-total") else "10"
            if scenario == "changing-total" and page == "2":
                total = "10"
            headers = {} if scenario == "missing-pagination" else {"X-Total": total}
            if scenario == "page-failure" and page == "2":
                self.reply(500, {"message": TOKEN})
            elif scenario == "pagination-loop":
                self.reply(200, [member(1)], {"X-Next-Page": "1"})
            elif scenario == "missing-pagination" and page == "1":
                self.reply(200, [member(i, access_level=10) for i in range(100, 200)])
            elif scenario == "empty":
                self.reply(200, [member(3, access_level=10)])
            elif page == "1":
                self.reply(200, [member(2), member(1)], {**headers, "X-Next-Page": "2"})
            else:
                self.reply(200, [member(3, access_level=10), member(4, state="blocked"),
                                 member(5), member(6, expires_at="2000-01-01"),
                                 member(7), member(8, access_level=15), member(9),
                                 member(10, expires_at=datetime.now(timezone.utc).date().isoformat())],
                           {**headers, "X-Next-Page": ""})
        elif endpoint.startswith("users/"):
            user_id = int(endpoint.split("/")[1])
            email = {1: "ALICE@example.com", 2: "bob@example.com", 7: "carol@example.com"}.get(
                user_id, f"service-{user_id}@example.com")
            if scenario == "duplicate-email" and user_id == 2:
                email = "alice@example.com"
            profile = {"id": user_id, "state": "active", "locked": user_id == 9,
                       "bot": user_id == 5, "email": email, "confirmed_at": "2025-01-01T00:00:00Z"}
            if user_id == 2:
                if scenario == "unconfirmed-email":
                    profile["confirmed_at"] = None
                elif scenario == "missing-confirmation":
                    profile.pop("confirmed_at")
                elif scenario == "invalid-confirmation":
                    profile["confirmed_at"] = "not-a-timestamp"
            if scenario == "hidden-email":
                profile.pop("email")
                profile["public_email"] = f"public-alias-{user_id}@example.com"
            if scenario == "wrong-identity":
                profile["id"] = 999
            self.reply(200, profile)
        else:
            self.reply(404, {"message": "Unexpected endpoint"})

    def reply(self, status, body, headers=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)


def run():
    report_path = Path(os.environ["GITLAB_EXPORT_REPORT_PATH"])
    report = {"boundary": "CLI subprocess against a local HTTPS GitLab API fixture", "checks": []}
    try:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cert, key = root / "cert.pem", root / "key.pem"
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-keyout", str(key), "-out", str(cert), "-subj", "/CN=localhost",
                "-addext", "subjectAltName=IP:127.0.0.1",
            ], check=True, capture_output=True)
            server = ThreadingHTTPServer(("127.0.0.1", 0), GitLabFixture)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(cert, key)
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for scenario, expected_error in [
                    ("success", None), ("numeric-project", None), ("missing-pagination", None),
                    ("issues-only", None), ("paced", None),
                    ("unconfirmed-email", None), ("missing-confirmation", None),
                    ("invalid-confirmation", None),
                    ("truncated-membership", "total"), ("changing-total", "changed"),
                    ("hidden-email", "email"), ("duplicate-email", "email"),
                    ("wrong-identity", "identity"), ("denied", "403"),
                    ("page-failure", "500"), ("pagination-loop", "pagination"),
                    ("redirect", "302"), ("empty", "readers"),
                    ("existing-output", "exists"),
                ]:
                    output = root / scenario
                    if scenario == "existing-output":
                        output.mkdir()
                        (output / "users.csv").write_text("keep the previous export")
                    command = [sys.executable, str(SCRIPT), "--gitlab-url",
                               f"https://127.0.0.1:{server.server_port}/{scenario}",
                               "--project", "91" if scenario == "numeric-project" else "engineering/platform",
                               "--output-dir", str(output),
                               "--requests-per-minute", "120" if scenario == "paced" else "600000"]
                    result = subprocess.run(command, capture_output=True, text=True, timeout=20,
                                            env={**os.environ, "GITLAB_EXPORT_TOKEN": TOKEN,
                                                 "SSL_CERT_FILE": str(cert)})
                    assert TOKEN not in result.stdout + result.stderr, "Token leaked in output"
                    if expected_error:
                        assert result.returncode != 0, f"{scenario}: export unexpectedly succeeded"
                        assert expected_error in result.stderr.lower(), (scenario, result.stderr)
                        if scenario == "existing-output":
                            assert (output / "users.csv").read_text() == "keep the previous export"
                        else:
                            assert not output.exists(), f"{scenario}: published a partial export"
                    else:
                        assert result.returncode == 0, (scenario, result.stderr)
                        with (output / "users.csv").open() as handle:
                            users = list(csv.reader(handle))
                        with (output / "project-permissions.csv").open() as handle:
                            grants = list(csv.reader(handle))
                        expected = [["7", "carol@example.com"]] if scenario == "missing-pagination" else [
                            ["1", "alice@example.com"], ["2", "bob@example.com"],
                            ["7", "carol@example.com"]]
                        if scenario in ("unconfirmed-email", "missing-confirmation", "invalid-confirmation"):
                            expected = [["1", "alice@example.com"], ["7", "carol@example.com"]]
                        assert users == [["user_id", "email"], *expected], users
                        assert grants == [["project_path", "user_id"], *[
                            ["engineering/platform", row[0]] for row in expected]], grants
                        parsed = subprocess.run([
                            "bun", "-e", """
import { parseGitLabCsv, gitLabCsvSubjects } from './connectors/gitlab/permission-config/parser'
const directory = process.argv[1]
const users = parseGitLabCsv({filename: 'users.csv', content: await Bun.file(`${directory}/users.csv`).text()}, 'userMapping')
const grants = parseGitLabCsv({filename: 'project-permissions.csv', content: await Bun.file(`${directory}/project-permissions.csv`).text()}, 'projectPermissions')
process.stdout.write(JSON.stringify({
  subjects: gitLabCsvSubjects(users, grants, 'engineering/platform'),
  otherProject: gitLabCsvSubjects(users, grants, 'engineering/other'),
}))
""", str(output),
                        ], cwd=SIM_ROOT, capture_output=True, text=True, timeout=20)
                        assert parsed.returncode == 0, parsed.stderr
                        assert json.loads(parsed.stdout) == {
                            "subjects": sorted("u:" + row[1] for row in expected),
                            "otherProject": [],
                        }, parsed.stdout
                        if scenario == "paced":
                            arrivals = [arrived for case, _, _, arrived in GitLabFixture.calls if case == scenario]
                            # The first request's transit time can consume one pacing interval.
                            minimum_span = (len(arrivals) - 2) * 0.5
                            assert arrivals[-1] - arrivals[0] >= minimum_span, "Requests exceeded the configured rate"
                            report["pacing"] = {"requests": len(arrivals), "requestsPerMinute": 120,
                                                "observedSeconds": arrivals[-1] - arrivals[0],
                                                "minimumSeconds": minimum_span}
                    report["checks"].append({"name": scenario, "passed": True})
                assert not any(endpoint == "trap" for _, endpoint, _, _ in GitLabFixture.calls)
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
    print(f"Passed {len(report['checks'])} exporter checks. Report: {report_path}")


if __name__ == "__main__":
    run()
