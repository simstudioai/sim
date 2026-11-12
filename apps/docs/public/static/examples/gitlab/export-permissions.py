#!/usr/bin/env python3
"""Export one GitLab project's readers to Sim's permission CSVs (Python 3.10+)."""

import argparse
import csv
from datetime import date, datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import ssl
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


MAX_BYTES = 4 * 1024 * 1024
MAX_ROWS = 100_000
EMAIL = re.compile(
    r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*"
)


class ExportError(Exception):
    """An incomplete or unsafe export must not be uploaded."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A redirect must never forward the private token to another host.
        return None


class GitLab:
    def __init__(self, base_url, token, requests_per_minute):
        parsed = urlsplit(base_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment
                or any(ord(char) < 33 for char in base_url)):
            raise ExportError("Use an HTTPS GitLab instance URL without credentials, query, or fragment.")
        self.base = base_url.rstrip("/") + "/api/v4/"
        self.token = token
        self.interval = 60 / requests_per_minute
        self.last_request = 0.0
        self.opener = build_opener(NoRedirects(), HTTPSHandler(context=ssl.create_default_context()))

    def get(self, path, query=None):
        delay = self.interval - (time.monotonic() - self.last_request)
        if delay > 0:
            time.sleep(delay)
        url = self.base + path + ("?" + urlencode(query) if query else "")
        request = Request(url, headers={"PRIVATE-TOKEN": self.token, "Accept": "application/json"})
        self.last_request = time.monotonic()
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                headers = response.headers
        except HTTPError as error:
            raise ExportError(f"GitLab GET {path} failed (HTTP {error.code}); no export published.") from None
        except (URLError, TimeoutError, OSError):
            raise ExportError("GitLab connection failed. Check the host, HTTPS trust, and network access.") from None
        if len(raw) > 8 * 1024 * 1024:
            raise ExportError("GitLab response exceeds the 8 MiB limit.")
        try:
            return json.loads(raw), headers
        except (ValueError, UnicodeError):
            raise ExportError("GitLab returned invalid JSON.") from None


def identifier(value):
    if type(value) is not int or not 0 < value <= 9_007_199_254_740_991:
        raise ExportError("GitLab returned an invalid numeric identity.")
    return value


def active(record):
    if not isinstance(record, dict) or not isinstance(record.get("state"), str):
        raise ExportError("GitLab returned a user without an account state.")
    return record["state"] == "active" and not record.get("locked", False)


def export(client, project):
    record, _ = client.get("projects/" + quote(project, safe=""))
    if not isinstance(record, dict):
        raise ExportError("GitLab returned an invalid project.")
    project_id = identifier(record.get("id"))
    project_path = record.get("path_with_namespace")
    if (not isinstance(project_path, str) or len(project_path) > 1024
            or "/" not in project_path
            or any(not part or part in (".", "..")
                   or not all(char.isalnum() or char in "_.-" for char in part)
                   for part in project_path.split("/"))):
        raise ExportError("GitLab returned an invalid project path.")
    users, emails, seen_members = {}, {}, set()
    today = datetime.now(timezone.utc).date()
    page = 1
    expected_total = None
    while page <= 1000:
        members, headers = client.get(f"projects/{project_id}/members/all",
                                      {"per_page": 100, "page": page})
        if not isinstance(members, list) or len(members) > 100:
            raise ExportError("GitLab returned an invalid membership page.")
        total = headers.get("X-Total")
        if total is not None:
            if not re.fullmatch(r"[0-9]{1,6}", total) or int(total) > MAX_ROWS:
                raise ExportError("GitLab membership total is invalid or exceeds the 100,000-row limit.")
            if expected_total is not None and int(total) != expected_total:
                raise ExportError("GitLab membership total changed during pagination. Rerun the export.")
            expected_total = int(total)
        for member in members:
            if not isinstance(member, dict):
                raise ExportError("GitLab returned an invalid membership.")
            user_id = identifier(member.get("id"))
            if user_id in seen_members:
                raise ExportError("GitLab membership pagination repeated a user. Rerun the export.")
            seen_members.add(user_id)
            if len(seen_members) > MAX_ROWS:
                raise ExportError("Project membership exceeds the 100,000-row limit.")
            role = member.get("access_level")
            if type(role) is not int:
                raise ExportError("GitLab returned a membership without an access level.")
            if not active(member) or role < 20:
                continue
            expiry = member.get("expires_at")
            if expiry is not None:
                try:
                    expired = date.fromisoformat(expiry) <= today
                except (TypeError, ValueError):
                    raise ExportError("GitLab returned an invalid membership expiry.") from None
                if expired:
                    continue
            profile, _ = client.get(f"users/{user_id}")
            if not isinstance(profile, dict) or identifier(profile.get("id")) != user_id:
                raise ExportError("GitLab returned a mismatched user identity.")
            if not active(profile) or profile.get("bot", False):
                continue
            confirmed_at = profile.get("confirmed_at")
            if not isinstance(confirmed_at, str):
                continue
            try:
                datetime.fromisoformat(confirmed_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            email = profile.get("email")
            if not isinstance(email, str):
                raise ExportError(
                    f"User {user_id}: primary email is unavailable. The CI token needs directory email access."
                )
            email = email.strip().lower()
            if len(email) > 254 or not EMAIL.fullmatch(email):
                raise ExportError(f"User {user_id}: primary email is invalid.")
            if email in emails and emails[email] != user_id:
                raise ExportError("Multiple GitLab users share an email. Resolve the identity conflict first.")
            emails[email] = user_id
            users[user_id] = email
        next_page = headers.get("X-Next-Page")
        if next_page is None:
            next_page = str(page + 1) if len(members) == 100 else ""
        if not next_page:
            break
        if not re.fullmatch(r"[0-9]+", next_page) or int(next_page) != page + 1 or not members:
            raise ExportError("GitLab returned invalid membership pagination.")
        page = int(next_page)
    else:
        raise ExportError("GitLab membership pagination exceeds 1,000 pages.")
    if expected_total is not None and len(seen_members) != expected_total:
        raise ExportError("Exported membership count does not match GitLab's total. Rerun the export.")
    if not users:
        raise ExportError("No eligible readers. Pause search in Sim; empty CSVs cannot revoke all grants.")
    return project_path, users


def write_export(output, project_path, users):
    files = {}
    ordered = sorted(users)
    for name, header, rows in [
        ("users.csv", ["user_id", "email"], [(user_id, users[user_id]) for user_id in ordered]),
        ("project-permissions.csv", ["project_path", "user_id"],
         [(project_path, user_id) for user_id in ordered]),
    ]:
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)
        files[name] = buffer.getvalue().encode("utf-8")
        if len(files[name]) > MAX_BYTES:
            raise ExportError(f"{name} exceeds Sim's 4 MiB CSV limit.")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Publish the pair together, so an interrupted export cannot mix new and old CSVs.
    with tempfile.TemporaryDirectory(dir=output.parent, prefix=".gitlab-export-") as temporary:
        for name, content in files.items():
            path = Path(temporary) / name
            path.write_bytes(content)
            path.chmod(0o600)
        os.rename(temporary, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitlab-url", required=True, help="HTTPS instance URL, without /api/v4")
    parser.add_argument("--project", required=True, help="Project ID or full namespace/project path")
    parser.add_argument("--output-dir", default="gitlab-permissions", help="New directory for both CSVs")
    parser.add_argument("--requests-per-minute", type=int, default=60, help="Request-start ceiling (default: 60)")
    args = parser.parse_args()
    token = os.environ.get("GITLAB_EXPORT_TOKEN", "")
    if not token or any(char.isspace() for char in token):
        parser.error("Set GITLAB_EXPORT_TOKEN to the CI export token.")
    if args.requests_per_minute <= 0:
        parser.error("--requests-per-minute must be positive.")
    output = Path(args.output_dir).absolute()
    if output.exists() or output.is_symlink():
        raise ExportError("Output directory already exists. Choose a new directory for a fresh export.")
    client = GitLab(args.gitlab_url, token, args.requests_per_minute)
    project_path, users = export(client, args.project)
    write_export(output, project_path, users)
    print(f"Exported {len(users)} readers to {output}/users.csv and {output}/project-permissions.csv")


if __name__ == "__main__":
    try:
        main()
    except (ExportError, OSError) as error:
        message = str(error) if isinstance(error, ExportError) else "Could not publish the CSV files."
        print(f"Export failed: {message}", file=sys.stderr)
        sys.exit(1)
