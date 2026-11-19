#!/usr/bin/env python3
"""Upload a complete Search permission CSV pair in bounded parts (Python 3.10+)."""

import argparse
import csv
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.client import HTTPException
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


PART_BYTES = 1024 * 1024
PART_ROWS = 5000
MAX_BYTES = 1024 * 1024 * 1024
MAX_PARTS = 4096
FILES = {
    "userMapping": (["user_id", "email"], 500_000),
    "projectPermissions": (["project_path", "user_id"], 5_000_000),
}


class UploadError(Exception):
    """The client could not confirm that the complete import succeeded."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the API key to a redirected origin.
        return None


def stage_files(directory, sources):
    """Freeze both input files on disk before declaring counts to the server."""
    manifests, parts = {}, []
    total_bytes = 0
    csv.field_size_limit(4096)
    for field, source in sources.items():
        header, max_rows = FILES[field]
        if (not source.name.strip() or len(source.name) > 255
                or any(ord(char) < 32 or ord(char) == 127 or char in "/\\" for char in source.name)):
            raise UploadError("Use CSV filenames of 1–255 characters without control characters.")
        header_bytes = (",".join(header) + "\n").encode("utf-8")
        content = bytearray(header_bytes)
        row_count, part_rows, part_count = 0, 0, 0

        def save_part():
            nonlocal total_bytes, part_count
            total_bytes += len(content)
            if total_bytes > MAX_BYTES:
                raise UploadError("The complete permission import exceeds 1 GiB.")
            if len(parts) >= MAX_PARTS:
                raise UploadError("The complete permission import exceeds 4,096 parts.")
            path = directory / str(len(parts))
            with path.open("xb") as handle:
                handle.write(content)
            path.chmod(0o600)
            parts.append((field, path))
            part_count += 1

        try:
            with source.open("r", encoding="utf-8-sig", newline="") as handle:
                before = os.fstat(handle.fileno())
                first_record = True
                record_characters = 0
                record_lines = []

                def lines():
                    nonlocal record_characters
                    while True:
                        line = handle.readline(8193)
                        if not line:
                            return
                        record_characters += len(line)
                        if record_characters > 8192:
                            raise UploadError(f"{field}: CSV record exceeds the field length limits.")
                        record_lines.append(line)
                        yield line

                for row in csv.reader(lines(), strict=True):
                    record_characters = 0
                    record = "".join(record_lines)
                    record_lines.clear()
                    if not row:
                        continue
                    if len(row) != 2:
                        raise UploadError(f"{field}: every CSV record must have exactly two columns.")
                    if first_record:
                        first_record = False
                        if [cell.strip() for cell in row] == header:
                            header_bytes = (record if record.endswith(("\n", "\r")) else record + "\n").encode("utf-8")
                            content = bytearray(header_bytes)
                            continue
                    row_count += 1
                    if row_count > max_rows:
                        raise UploadError(f"{field}: exceeds {max_rows:,} data records.")
                    encoded = (record if record.endswith(("\n", "\r")) else record + "\n").encode("utf-8")
                    if len(header_bytes) + len(encoded) > PART_BYTES:
                        raise UploadError(f"{field}: a CSV record exceeds the part size limit.")
                    if part_rows == PART_ROWS or len(content) + len(encoded) > PART_BYTES:
                        save_part()
                        content = bytearray(header_bytes)
                        part_rows = 0
                    content.extend(encoded)
                    part_rows += 1
                after = os.fstat(handle.fileno())
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise UploadError("An input CSV changed during staging. Rerun the export.")
        except (csv.Error, UnicodeError):
            raise UploadError(f"{field}: malformed UTF-8 CSV. Check quoting and field lengths.") from None
        if not row_count:
            raise UploadError(f"{field}: at least one data record is required. Pause search to revoke all access.")
        save_part()
        manifests[field] = {"filename": source.name, "parts": part_count, "rowCount": row_count}
    return manifests, parts


class Sim:
    def __init__(self, base_url, organization_id, source_id, api_key):
        parsed = urlsplit(base_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or any(ord(char) < 33 for char in base_url)):
            raise UploadError("SIM_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.")
        if not organization_id or not source_id:
            raise UploadError("Set SIM_ORG_ID and SIM_SOURCE_ID to the existing source's identifiers.")
        if not api_key or any(char.isspace() for char in api_key):
            raise UploadError("Set SIM_API_KEY to an organization admin's personal API key with Full access.")
        self.url = (base_url.rstrip("/") + "/api/v2/organizations/" + quote(organization_id, safe="")
                    + "/search/sources/" + quote(source_id, safe="") + "/permissions/imports")
        self.api_key = api_key
        self.opener = build_opener(NoRedirects(), HTTPSHandler(context=ssl.create_default_context()))

    def request(self, method, suffix, payload, retry=False):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        for attempt in range(5 if retry else 1):
            request = Request(self.url + suffix, data=body, method=method, headers={
                "X-API-Key": self.api_key, "Accept": "application/json", "Content-Type": "application/json",
            })
            delay = min(2 ** attempt, 30)
            try:
                with self.opener.open(request, timeout=120) as response:
                    raw = response.read(65537)
                if len(raw) > 65536:
                    raise UploadError("Sim returned an oversized response.")
                result = json.loads(raw)
                if not isinstance(result, dict) or not isinstance(result.get("data"), dict):
                    raise UploadError("Sim returned an invalid response.")
                return result["data"]
            except HTTPError as error:
                status, retry_after = error.code, error.headers.get("Retry-After")
                message = ""
                try:
                    raw = error.read(65537)
                    result = json.loads(raw) if len(raw) <= 65536 else None
                    detail = result.get("error") if isinstance(result, dict) else None
                    if isinstance(detail, dict) and isinstance(detail.get("message"), str):
                        redacted = detail["message"].replace(self.api_key, "[redacted]")
                        message = " ".join("".join(char if char.isprintable() else " " for char in redacted).split())[:1024]
                except (ValueError, UnicodeError, OSError, HTTPException):
                    pass
                finally:
                    error.close()
                reason = f": {message}" if message else "; the upload did not finish."
                if status == 409:
                    raise UploadError(f"Import conflict (HTTP 409){reason} Rerun the job from the revision read and export; do not force a newer revision.") from None
                if not retry or attempt == 4 or (status != 429 and not 500 <= status <= 599):
                    raise UploadError(f"Sim {method} failed (HTTP {status}){reason}") from None
                if retry_after:
                    try:
                        delay = max(delay, int(retry_after) if retry_after.isdigit() else
                                    (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds())
                    except (ValueError, TypeError, OverflowError):
                        pass
                    if delay > 300:
                        raise UploadError("Sim requested a retry after more than five minutes. Rerun the job later.") from None
            except (URLError, OSError, HTTPException):
                if not retry or attempt == 4:
                    raise UploadError("Sim connection failed. Check HTTPS trust and network access; the upload may need to be retried.") from None
            except (ValueError, UnicodeError):
                raise UploadError("Sim returned invalid JSON.") from None
            time.sleep(delay)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", required=True, choices=["gitlab"])
    parser.add_argument("--expected-revision", required=True, type=int,
                        help="Source revision read before exporting these CSVs")
    parser.add_argument("--user-mapping", required=True, type=Path)
    parser.add_argument("--project-permissions", required=True, type=Path)
    args = parser.parse_args()
    if args.expected_revision < 1:
        raise UploadError("Use the positive source revision read before the export.")
    client = Sim(os.environ.get("SIM_BASE_URL", "https://www.sim.ai"),
                 os.environ.get("SIM_ORG_ID"), os.environ.get("SIM_SOURCE_ID"),
                 os.environ.get("SIM_API_KEY"))
    with tempfile.TemporaryDirectory(prefix="sim-permission-import-") as temporary:
        manifests, parts = stage_files(Path(temporary), {
            "userMapping": args.user_mapping, "projectPermissions": args.project_permissions,
        })
        created = client.request("POST", "", {
            "provider": args.provider, "expectedRevision": args.expected_revision, **manifests,
        })
        import_id = created.get("id")
        if not isinstance(import_id, str) or not import_id or len(import_id) > 255:
            raise UploadError("Sim returned an invalid import identifier.")
        suffix = "/" + quote(import_id, safe="")
        for number, (field, path) in enumerate(parts):
            result = client.request("PUT", f"{suffix}/parts/{number}", {
                "field": field, "content": path.read_text(encoding="utf-8"),
            }, retry=True)
            if type(result.get("nextPart")) is not int or result["nextPart"] != number + 1:
                raise UploadError("Sim returned an unexpected part number; the import was not completed.")
        result = client.request("POST", suffix + "/complete", {}, retry=True)
        if type(result.get("revision")) is not int or result["revision"] <= args.expected_revision:
            raise UploadError("Sim returned an invalid completed revision.")
        print(json.dumps({"revision": result["revision"]}))


if __name__ == "__main__":
    try:
        main()
    except (UploadError, OSError) as error:
        message = str(error) if isinstance(error, UploadError) else "Could not read or stage the CSV files."
        print(f"Upload failed: {message}", file=sys.stderr)
        sys.exit(1)
