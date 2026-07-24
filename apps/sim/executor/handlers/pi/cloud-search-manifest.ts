import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { PiSandboxRunner } from '@/lib/execution/remote-sandbox'

export const SEARCH_MANIFEST_PATH = '/workspace/pi-search-manifest.json'
export const MAX_SEARCH_CHANGED_FILES = 50
export const MAX_SEARCH_MANIFEST_CONTENT_BYTES = 1024 * 1024
export const MAX_SEARCH_MANIFEST_ENCODED_BYTES = 1536 * 1024

export interface SearchManifestWrite {
  path: string
  mode: '100644' | '100755'
  contentBase64: string
  sha256: string
}

export interface SearchChangeManifest {
  baseSha: string
  writes: SearchManifestWrite[]
  deletes: string[]
}

export const BUILD_SEARCH_MANIFEST_SCRIPT = String.raw`set -euo pipefail
cd /workspace
python3 -I - <<'PY'
import base64, hashlib, json, os, stat, subprocess

base = os.environ["BASE_SHA"]
raw = subprocess.check_output(
    ["git", "diff", "--name-only", "--no-renames", "-z", base, "--"],
    cwd="/workspace/repo",
)
untracked = subprocess.check_output(
    ["git", "ls-files", "--others", "--exclude-standard", "-z", "--"],
    cwd="/workspace/repo",
)
paths = sorted(set(part.decode("utf-8") for part in (raw + untracked).split(b"\0") if part))
if len(paths) > 50:
    raise SystemExit("too many changed files")

writes = []
deletes = []
total = 0
for path in paths:
    components = path.split("/")
    if (
        path.startswith("/")
        or any(
            not part
            or part in (".", "..")
            or part.startswith("-")
            or part.endswith((".", " "))
            or part.casefold() in (".git", "git~1")
            or any(ord(char) < 32 or ord(char) == 127 for char in part)
            for part in components
        )
    ):
        raise SystemExit("unsafe path")
    full = os.path.join("/workspace/repo", path)
    if not os.path.lexists(full):
        deletes.append(path)
        continue
    parts = path.split("/")
    directory_fd = os.open("/workspace/repo", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in parts[:-1]:
            next_fd = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=directory_fd,
            )
            os.close(directory_fd)
            directory_fd = next_fd
        fd = os.open(
            parts[-1],
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise SystemExit("only regular files may be transferred")
            remaining = 1024 * 1024 - total
            data = os.read(fd, remaining + 1)
            if len(data) > remaining:
                raise SystemExit("changed file content limit exceeded")
        finally:
            os.close(fd)
    finally:
        os.close(directory_fd)
    total += len(data)
    writes.append({
        "path": path,
        "mode": "100755" if info.st_mode & stat.S_IXUSR else "100644",
        "contentBase64": base64.b64encode(data).decode("ascii"),
        "sha256": hashlib.sha256(data).hexdigest(),
    })

payload = {"baseSha": base, "writes": writes, "deletes": deletes}
encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
if len(encoded) > 1536 * 1024:
    raise SystemExit("encoded manifest limit exceeded")
open("/workspace/pi-search-manifest.json", "wb").write(encoded)
PY`

const READ_FILE_WITH_LIMIT_SCRIPT = `set -euo pipefail
cd /workspace
python3 -I - <<'PY'
import os, stat, sys
path = os.environ["READ_PATH"]
limit = int(os.environ["READ_LIMIT"])
fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        raise SystemExit("not a regular file")
    data = os.read(fd, limit + 1)
    if len(data) > limit:
        raise SystemExit("file exceeds limit")
    sys.stdout.buffer.write(data)
finally:
    os.close(fd)
PY`

function safePath(path: string): boolean {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path !== path.normalize('NFC') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return false
  }
  const parts = path.split('/')
  return !parts.some((part) => {
    const folded = part.toLocaleLowerCase('en-US')
    return (
      !part ||
      part === '.' ||
      part === '..' ||
      part.startsWith('-') ||
      part.endsWith('.') ||
      part.endsWith(' ') ||
      folded === '.git' ||
      folded === 'git~1'
    )
  })
}

function parseWrite(value: unknown): SearchManifestWrite {
  if (!value || typeof value !== 'object') throw new Error('Manifest write must be an object')
  const record = value as Record<string, unknown>
  if (
    typeof record.path !== 'string' ||
    !safePath(record.path) ||
    (record.mode !== '100644' && record.mode !== '100755') ||
    typeof record.contentBase64 !== 'string' ||
    typeof record.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.sha256)
  ) {
    throw new Error('Manifest write is invalid')
  }
  const bytes = Buffer.from(record.contentBase64, 'base64')
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
    throw new Error('Manifest content hash mismatch')
  }
  return {
    path: record.path,
    mode: record.mode,
    contentBase64: record.contentBase64,
    sha256: record.sha256,
  }
}

export function parseSearchChangeManifest(value: string): SearchChangeManifest {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object') throw new Error('Manifest must be an object')
  const record = parsed as Record<string, unknown>
  if (
    typeof record.baseSha !== 'string' ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(record.baseSha) ||
    !Array.isArray(record.writes) ||
    !Array.isArray(record.deletes)
  ) {
    throw new Error('Manifest shape is invalid')
  }
  const writes = record.writes.map(parseWrite)
  const deletes = record.deletes.map((path) => {
    if (typeof path !== 'string' || !safePath(path)) throw new Error('Manifest delete is invalid')
    return path
  })
  if (writes.length + deletes.length > MAX_SEARCH_CHANGED_FILES) {
    throw new Error('Manifest changed file limit exceeded')
  }
  const normalized = [...writes.map((write) => write.path), ...deletes]
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Manifest contains duplicate paths')
  }
  const caseFolded = normalized.map((path) => path.toLocaleLowerCase('en-US'))
  if (new Set(caseFolded).size !== caseFolded.length) {
    throw new Error('Manifest contains case-colliding paths')
  }
  const totalBytes = writes.reduce(
    (sum, write) => sum + Buffer.from(write.contentBase64, 'base64').byteLength,
    0
  )
  if (totalBytes > MAX_SEARCH_MANIFEST_CONTENT_BYTES) {
    throw new Error('Manifest content limit exceeded')
  }
  return { baseSha: record.baseSha, writes, deletes }
}

export async function readSearchManifest(runner: PiSandboxRunner): Promise<SearchChangeManifest> {
  return parseSearchChangeManifest(
    await readBoundedSandboxFile(runner, SEARCH_MANIFEST_PATH, MAX_SEARCH_MANIFEST_ENCODED_BYTES)
  )
}

export async function readBoundedSandboxFile(
  runner: PiSandboxRunner,
  path: string,
  maxBytes: number
): Promise<string> {
  const result = await runner.run(READ_FILE_WITH_LIMIT_SCRIPT, {
    envs: {
      READ_PATH: path,
      READ_LIMIT: String(maxBytes),
    },
    timeoutMs: 30_000,
    maxStdoutBytes: maxBytes,
    maxStderrBytes: 16 * 1024,
    maxCombinedBytes: maxBytes + 16 * 1024,
  })
  if (result.exitCode !== 0 || result.outputLimitExceeded) {
    throw new Error(result.stderr || 'Failed to read bounded sandbox file')
  }
  return result.stdout
}
