import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { PiSandboxRunner } from '@/lib/execution/e2b'
import { raceAbort } from '@/executor/handlers/pi/cloud-shared'
import type { PiSdk } from '@/executor/handlers/pi/pi-sdk'
import {
  parseReviewFindings,
  type ReviewFindings,
  reviewFindingsSchema,
} from '@/tools/github/review-schema'

const REVIEW_TOOLS_SCRIPT_PATH = '/workspace/sim-review-tools.py'
const REVIEW_TOOLS_COMMAND = `python3 ${REVIEW_TOOLS_SCRIPT_PATH}`
const REVIEW_TOOL_TIMEOUT_MS = 30_000
const MAX_TOOL_CALLS = 200
const MAX_TOOL_OUTPUT_BYTES = 5_000_000

const REVIEW_TOOL_NAMES = {
  read: 'read_repo_file',
  search: 'search_repo',
  find: 'find_repo_files',
  list: 'list_repo_directory',
  changed: 'list_changed_files',
  diff: 'read_file_diff',
  submit: 'submit_review',
} as const

export const CLOUD_REVIEW_TOOL_NAMES = Object.values(REVIEW_TOOL_NAMES)

const REVIEW_TOOLS_SCRIPT = String.raw`
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path('/workspace/repo').resolve()
GIT_DIR = ROOT / '.git'
MAX_OUTPUT_BYTES = 50_000
MAX_JSON_OUTPUT_BYTES = 45_000
MAX_DIFF_BYTES = 50_000
MAX_DIFF_LINE_BYTES = 2_000
MAX_READ_SOURCE_BYTES = 5_000_000
MAX_DIRECTORY_SCAN = 5_000
COMMENTABLE_DIFF_CONTEXT = 3
MAX_CHECKOUT_FILES = 100_000
MAX_CHECKOUT_BYTES = 1_000_000_000
MAX_CHECKOUT_BLOB_BYTES = 100_000_000

def fail(message):
    sys.stderr.write(message)
    raise SystemExit(2)

def load_args():
    try:
        value = json.loads(os.environ.get('REVIEW_TOOL_ARGS', '{}'))
    except json.JSONDecodeError:
        fail('Invalid tool arguments')
    if not isinstance(value, dict):
        fail('Tool arguments must be an object')
    return value

def relative_path(raw):
    if not isinstance(raw, str) or not raw or '\x00' in raw:
        fail('path must be a non-empty repository-relative string')
    value = pathlib.PurePosixPath(raw)
    if value.is_absolute() or '..' in value.parts:
        fail('path must stay within the repository')
    normalized = value.as_posix()
    if normalized != raw:
        fail('path must use its canonical repository-relative form')
    if value.parts and value.parts[0] == '.git':
        fail('the .git directory is not reviewable')
    return normalized

def resolved_path(raw):
    relative = relative_path(raw)
    try:
        candidate = (ROOT / relative).resolve(strict=True)
    except FileNotFoundError:
        fail('path does not exist: ' + relative)
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        fail('path resolves outside the repository')
    try:
        candidate.relative_to(GIT_DIR)
        fail('the .git directory is not reviewable')
    except ValueError:
        return candidate

def emit(value, max_bytes=MAX_OUTPUT_BYTES, truncated=False):
    data = value.encode('utf-8', errors='replace')
    if len(data) > max_bytes:
        data = data[:max_bytes]
        truncated = True
    if truncated:
        notice = b'\n\n[output truncated]'
        if len(data) + len(notice) > max_bytes:
            data = data[:max_bytes - len(notice)]
        data += notice
    sys.stdout.buffer.write(data)

def process_env():
    env = {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
        'GIT_CONFIG_NOSYSTEM': '1',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_TERMINAL_PROMPT': '0',
    }
    return env

def run_bounded(command, cwd, max_bytes, accepted_codes=(0,), line_limit=None):
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=process_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    output = bytearray()
    truncated = False
    while len(output) <= max_bytes:
        chunk = process.stdout.read(min(4096, max_bytes + 1 - len(output)))
        if not chunk:
            break
        output.extend(chunk)
        if line_limit is not None and output.count(b'\n') >= line_limit:
            truncated = True
            break
    if len(output) > max_bytes:
        del output[max_bytes:]
        truncated = True
    if truncated and process.poll() is None:
        process.kill()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    if not truncated and process.returncode not in accepted_codes:
        message = output[:8192].decode('utf-8', errors='replace').strip()
        fail(message or 'command failed with exit code ' + str(process.returncode))
    text = output.decode('utf-8', errors='replace')
    if line_limit is not None:
        lines = text.splitlines()
        if len(lines) > line_limit:
            text = '\n'.join(lines[:line_limit])
            truncated = True
    return text, truncated

def read_file(args):
    path = resolved_path(args.get('path'))
    if not path.is_file():
        fail('path is not a file')
    size = path.stat().st_size
    if size > MAX_READ_SOURCE_BYTES:
        fail('file exceeds the 5 MB read limit; use search_repo to narrow the review')
    offset = args.get('offset', 1)
    limit = args.get('limit', 500)
    with path.open('rb') as handle:
        data = handle.read(MAX_READ_SOURCE_BYTES + 1)
    text = data.decode('utf-8', errors='replace')
    lines = text.splitlines()
    if offset > len(lines) and lines:
        fail('offset is beyond the end of the file')
    selected = lines[offset - 1:offset - 1 + limit]
    output = '\n'.join(str(offset + index) + ': ' + line for index, line in enumerate(selected))
    emit(output or '(empty file)', truncated=offset - 1 + limit < len(lines))

def search_repo(args):
    path = resolved_path(args.get('path', '.'))
    command = ['rg', '--line-number', '--color=never', '--hidden']
    if args.get('ignore_case'):
        command.append('--ignore-case')
    if args.get('literal'):
        command.append('--fixed-strings')
    glob = args.get('glob')
    if glob:
        command.extend(['--glob', glob])
    command.extend(['--glob', '!**/.git/**'])
    command.extend(['--', args['pattern'], str(path)])
    output, truncated = run_bounded(
        command,
        ROOT,
        MAX_OUTPUT_BYTES,
        accepted_codes=(0, 1),
        line_limit=args.get('limit', 100),
    )
    root_prefix = str(ROOT) + os.sep
    normalized = '\n'.join(
        line[len(root_prefix):] if line.startswith(root_prefix) else line
        for line in output.splitlines()
    )
    emit(normalized or 'No matches found', truncated=truncated)

def find_files(args):
    path = resolved_path(args.get('path', '.'))
    if not path.is_dir():
        fail('path is not a directory')
    command = ['rg', '--files', '--hidden']
    pattern = args.get('pattern')
    if pattern:
        command.extend(['--glob', pattern])
    command.extend(['--glob', '!**/.git/**'])
    command.extend(['--', str(path)])
    output, truncated = run_bounded(
        command,
        ROOT,
        MAX_OUTPUT_BYTES,
        accepted_codes=(0, 1),
        line_limit=args.get('limit', 500),
    )
    root_prefix = str(ROOT) + os.sep
    normalized = '\n'.join(
        line[len(root_prefix):] if line.startswith(root_prefix) else line
        for line in output.splitlines()
    )
    emit(normalized or 'No files found', truncated=truncated)

def list_directory(args):
    path = resolved_path(args.get('path', '.'))
    if not path.is_dir():
        fail('path is not a directory')
    limit = args.get('limit', 200)
    entries = []
    scanned = 0
    with os.scandir(path) as iterator:
        for entry in iterator:
            scanned += 1
            if scanned > MAX_DIRECTORY_SCAN:
                break
            if path == ROOT and entry.name == '.git':
                continue
            suffix = '/' if entry.is_dir(follow_symlinks=False) else ''
            entries.append(entry.name + suffix)
    entries.sort(key=str.casefold)
    truncated = len(entries) > limit or scanned > MAX_DIRECTORY_SCAN
    emit('\n'.join(entries[:limit]) or '(empty directory)', truncated=truncated)

def validate_sha(value, label):
    if not isinstance(value, str) or re.fullmatch(r'(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})', value) is None:
        fail(label + ' must be a full commit SHA')
    return value

def bounded_lines(stream, max_line_bytes=512):
    prefix = bytearray()
    truncated = False
    while True:
        chunk = stream.read(8192)
        if not chunk:
            break
        for byte in chunk:
            if byte == 10:
                yield bytes(prefix), truncated
                prefix.clear()
                truncated = False
            elif len(prefix) < max_line_bytes:
                prefix.append(byte)
            else:
                truncated = True
    if prefix:
        yield bytes(prefix), truncated

def changed_files_process(base_sha, head_sha):
    command = [
        'git', '--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', 'diff',
        '--no-ext-diff', '--no-textconv', '--find-renames=50%', '--name-status', '-z',
        base_sha + '...' + head_sha,
    ]
    return subprocess.Popen(
        command,
        cwd=str(ROOT),
        env=process_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

def nul_records(stream):
    pending = bytearray()
    while True:
        chunk = stream.read(8192)
        if not chunk:
            break
        pending.extend(chunk)
        while b'\x00' in pending:
            record, _, remainder = pending.partition(b'\x00')
            pending = bytearray(remainder)
            if len(record) > 4_096:
                fail('Repository contains a path longer than 4,096 bytes')
            yield record.decode('utf-8', errors='replace')
        if len(pending) > 4_096:
            fail('Repository contains a path longer than 4,096 bytes')
    if pending:
        fail('git returned an incomplete changed-file record')

def finish_process(process, stopped_early=False):
    if stopped_early and process.poll() is None:
        process.kill()
    process.wait()
    if not stopped_early and process.returncode != 0:
        fail('git diff failed while reading changed files')

def changed_file_entries(process):
    records = iter(nul_records(process.stdout))
    while True:
        try:
            status = next(records)
        except StopIteration:
            return
        if re.fullmatch(r'[ACDMRTUXB][0-9]*', status) is None:
            fail('git returned an invalid changed-file status')
        try:
            first_path = next(records)
            if status[0] in ('R', 'C'):
                second_path = next(records)
                yield second_path, [first_path, second_path]
            else:
                yield first_path, [first_path]
        except StopIteration:
            fail('git returned an incomplete changed-file entry')

def list_changed_files(args):
    base_sha = validate_sha(args.get('base_sha'), 'base_sha')
    head_sha = validate_sha(args.get('head_sha'), 'head_sha')
    offset = args.get('offset', 0)
    limit = args.get('limit', 200)
    process = changed_files_process(base_sha, head_sha)
    files = []
    output_bytes = 64
    stopped_early = False
    for index, (path, _) in enumerate(changed_file_entries(process)):
        if index < offset:
            continue
        encoded_size = len(json.dumps(path, ensure_ascii=False).encode('utf-8')) + 2
        if len(files) == limit or (files and output_bytes + encoded_size > MAX_JSON_OUTPUT_BYTES):
            stopped_early = True
            break
        files.append(path)
        output_bytes += encoded_size
    finish_process(process, stopped_early)
    next_offset = offset + len(files) if stopped_early else None
    emit(json.dumps({'files': files, 'next_offset': next_offset}, ensure_ascii=False))

def changed_pathspecs(base_sha, head_sha, requested):
    if not requested:
        return {}
    process = changed_files_process(base_sha, head_sha)
    found = {}
    for path, pathspecs in changed_file_entries(process):
        if path in requested:
            found[path] = pathspecs
            if len(found) == len(requested):
                finish_process(process, stopped_early=True)
                return found
    finish_process(process)
    return found

def read_file_diff(args):
    base_sha = validate_sha(args.get('base_sha'), 'base_sha')
    head_sha = validate_sha(args.get('head_sha'), 'head_sha')
    path = relative_path(args.get('path'))
    changed = changed_pathspecs(base_sha, head_sha, {path})
    if path not in changed:
        fail('path is not an exact changed filename in the pull request')
    offset = args.get('offset', 0)
    limit = args.get('limit', 100)
    command = [
        'git', '--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', 'diff',
        '--no-ext-diff', '--no-textconv', '--find-renames=50%', f'--unified={COMMENTABLE_DIFF_CONTEXT}',
        base_sha + '...' + head_sha, '--', *changed[path],
    ]
    process = subprocess.Popen(
        command,
        cwd=str(ROOT),
        env=process_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    rows = []
    output_bytes = len(
        json.dumps({'path': path, 'diff': '', 'next_offset': None}, ensure_ascii=False).encode('utf-8')
    ) + 64
    stopped_early = False
    for index, (raw, line_truncated) in enumerate(bounded_lines(process.stdout, MAX_DIFF_LINE_BYTES)):
        if index < offset:
            continue
        text = raw.decode('utf-8', errors='replace')
        if line_truncated:
            text += ' [line truncated]'
        row = str(index + 1) + ': ' + text
        encoded_size = len(json.dumps(row, ensure_ascii=False).encode('utf-8')) + 2
        if len(rows) == limit or (rows and output_bytes + encoded_size > MAX_DIFF_BYTES - 1_024):
            stopped_early = True
            break
        rows.append(row)
        output_bytes += encoded_size
    if stopped_early and process.poll() is None:
        process.kill()
    process.wait()
    if not stopped_early and process.returncode != 0:
        fail('git diff failed while reading file diff')
    next_offset = offset + len(rows) if stopped_early else None
    emit(
        json.dumps(
            {'path': path, 'diff': '\n'.join(rows) or '(no textual diff)', 'next_offset': next_offset},
            ensure_ascii=False,
        ),
        max_bytes=MAX_DIFF_BYTES,
    )

def reviewable_coordinates(base_sha, head_sha, pathspecs, comments):
    command = [
        'git', '--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', 'diff', '--no-ext-diff', '--no-textconv',
        '--find-renames=50%', f'--unified={COMMENTABLE_DIFF_CONTEXT}', base_sha + '...' + head_sha, '--', *pathspecs
    ]
    process = subprocess.Popen(
        command,
        cwd=str(ROOT),
        env=process_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    wanted_left = set()
    wanted_right = set()
    for comment in comments:
        target = wanted_left if comment['side'] == 'LEFT' else wanted_right
        target.add(comment['line'])
        if 'start_line' in comment:
            start_target = wanted_left if comment['start_side'] == 'LEFT' else wanted_right
            start_target.add(comment['start_line'])
    found_left = {}
    found_right = {}
    old_line = None
    new_line = None
    hunk_id = 0
    hunk = re.compile(rb'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@')
    for raw, _ in bounded_lines(process.stdout):
        match = hunk.match(raw)
        if match:
            hunk_id += 1
            old_line = int(match.group(1))
            new_line = int(match.group(2))
            continue
        if old_line is None or new_line is None or not raw:
            continue
        prefix = raw[:1]
        if prefix == b' ':
            if new_line in wanted_right:
                found_right[new_line] = hunk_id
            old_line += 1
            new_line += 1
        elif prefix == b'-':
            if old_line in wanted_left:
                found_left[old_line] = hunk_id
            old_line += 1
        elif prefix == b'+':
            if new_line in wanted_right:
                found_right[new_line] = hunk_id
            new_line += 1
    process.wait()
    if process.returncode != 0:
        fail('git diff failed while validating comments')
    return found_left, found_right

def preflight_checkout(args):
    head_sha = validate_sha(args.get('head_sha'), 'head_sha')
    command = ['git', 'ls-tree', '-r', '-l', '-z', head_sha]
    process = subprocess.Popen(
        command,
        cwd=str(ROOT),
        env=process_env(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    pending = bytearray()
    file_count = 0
    total_bytes = 0
    while True:
        chunk = process.stdout.read(8192)
        if not chunk:
            break
        pending.extend(chunk)
        while b'\x00' in pending:
            record, _, remainder = pending.partition(b'\x00')
            pending = bytearray(remainder)
            header = record.split(b'\t', 1)[0].split()
            if len(header) < 4 or header[1] != b'blob':
                continue
            try:
                size = int(header[3])
            except ValueError:
                fail('Unable to determine repository blob size')
            file_count += 1
            total_bytes += size
            if file_count > MAX_CHECKOUT_FILES:
                process.kill()
                fail('Repository checkout exceeds the 100,000 file limit')
            if size > MAX_CHECKOUT_BLOB_BYTES:
                process.kill()
                fail('Repository checkout contains a blob larger than 100 MB')
            if total_bytes > MAX_CHECKOUT_BYTES:
                process.kill()
                fail('Repository checkout exceeds the 1 GB file budget')
        if len(pending) > 8192:
            process.kill()
            fail('Repository contains an unsupported path length')
    process.wait()
    if process.returncode != 0:
        fail('Unable to inspect the repository checkout')
    emit('Repository checkout is within limits')

def validate_comments(args):
    base_sha = validate_sha(args.get('base_sha'), 'base_sha')
    head_sha = validate_sha(args.get('head_sha'), 'head_sha')
    comments = args.get('comments')
    if not isinstance(comments, list):
        fail('comments must be an array')
    grouped = {}
    for index, comment in enumerate(comments):
        path = relative_path(comment.get('path'))
        grouped.setdefault(path, []).append((index, comment))
    failures = []
    changed = changed_pathspecs(base_sha, head_sha, set(grouped))
    for path, indexed_comments in grouped.items():
        if path not in changed:
            for index, _ in indexed_comments:
                failures.append('comments[' + str(index) + '] path is not an exact changed filename')
            continue
        found_left, found_right = reviewable_coordinates(
            base_sha,
            head_sha,
            changed[path],
            [comment for _, comment in indexed_comments],
        )
        for index, comment in indexed_comments:
            found = found_left if comment['side'] == 'LEFT' else found_right
            if comment['line'] not in found:
                failures.append('comments[' + str(index) + '] line is not on the requested diff side')
            if 'start_line' in comment:
                if comment['start_side'] != comment['side']:
                    failures.append('comments[' + str(index) + '] multiline range must stay on one diff side')
                start_found = found_left if comment['start_side'] == 'LEFT' else found_right
                if comment['start_line'] not in start_found:
                    failures.append('comments[' + str(index) + '] start_line is not on the requested diff side')
                elif comment['line'] in found and start_found[comment['start_line']] != found[comment['line']]:
                    failures.append('comments[' + str(index) + '] multiline range must stay in one diff hunk')
    if failures:
        fail('; '.join(failures))
    emit('Review coordinates are valid')

operation = os.environ.get('REVIEW_TOOL_OPERATION')
arguments = load_args()
if operation == 'read':
    read_file(arguments)
elif operation == 'search':
    search_repo(arguments)
elif operation == 'find':
    find_files(arguments)
elif operation == 'list':
    list_directory(arguments)
elif operation == 'list_changed_files':
    list_changed_files(arguments)
elif operation == 'read_file_diff':
    read_file_diff(arguments)
elif operation == 'validate_comments':
    validate_comments(arguments)
elif operation == 'preflight_checkout':
    preflight_checkout(arguments)
else:
    fail('Unknown review tool operation')
`

interface CloudReviewTools {
  tools: ToolDefinition[]
  getFindings: () => ReviewFindings | undefined
}

interface ReviewCommentCoordinate {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  start_line?: number
  start_side?: 'LEFT' | 'RIGHT'
}

interface ReviewOperationArgs {
  read: { path: string; offset?: number; limit?: number }
  search: {
    pattern: string
    path?: string
    glob?: string
    ignore_case?: boolean
    literal?: boolean
    limit?: number
  }
  find: { pattern?: string; path?: string; limit?: number }
  list: { path?: string; limit?: number }
  list_changed_files: { base_sha: string; head_sha: string; offset?: number; limit?: number }
  read_file_diff: {
    base_sha: string
    head_sha: string
    path: string
    offset?: number
    limit?: number
  }
  validate_comments: {
    base_sha: string
    head_sha: string
    comments: ReviewCommentCoordinate[]
  }
  preflight_checkout: { head_sha: string }
}

type ReviewOperation = keyof ReviewOperationArgs

/** Installs the fixed sandbox helper used by every bounded read-only review tool. */
export async function installCloudReviewTools(runner: PiSandboxRunner): Promise<void> {
  await runner.writeFile(REVIEW_TOOLS_SCRIPT_PATH, REVIEW_TOOLS_SCRIPT)
}

/** Rejects repository trees that would exceed the review sandbox checkout budget. */
export async function preflightCloudReviewCheckout(
  runner: PiSandboxRunner,
  headSha: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new Error('Pi cloud review aborted before checkout')
  const operation: ReviewOperation = 'preflight_checkout'
  const args: ReviewOperationArgs[typeof operation] = { head_sha: headSha }
  const result = await raceAbort(
    runner.run(REVIEW_TOOLS_COMMAND, {
      envs: {
        REVIEW_TOOL_OPERATION: operation,
        REVIEW_TOOL_ARGS: JSON.stringify(args),
      },
      timeoutMs: REVIEW_TOOL_TIMEOUT_MS,
    }),
    signal
  )
  if (signal?.aborted) throw new Error('Pi cloud review aborted before checkout')
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'Repository checkout preflight failed')
  }
}

/** Builds the only tools available to the host-side Pi review session. */
export function createCloudReviewTools(
  sdk: PiSdk,
  runner: PiSandboxRunner,
  baseSha: string,
  headSha: string
): CloudReviewTools {
  let findings: ReviewFindings | undefined
  let toolCalls = 0
  let outputBytes = 0

  const runOperation = async <Operation extends ReviewOperation>(
    operation: Operation,
    args: ReviewOperationArgs[Operation],
    signal?: AbortSignal
  ): Promise<string> => {
    if (signal?.aborted) throw new Error('Review tool operation aborted')
    toolCalls += 1
    if (toolCalls > MAX_TOOL_CALLS) {
      throw new Error(`Review tool call limit exceeded (${MAX_TOOL_CALLS})`)
    }

    const result = await raceAbort(
      runner.run(REVIEW_TOOLS_COMMAND, {
        envs: {
          REVIEW_TOOL_OPERATION: operation,
          REVIEW_TOOL_ARGS: JSON.stringify(args),
        },
        timeoutMs: REVIEW_TOOL_TIMEOUT_MS,
      }),
      signal
    )
    if (signal?.aborted) throw new Error('Review tool operation aborted')
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `${operation} failed inside the review sandbox`)
    }

    outputBytes += Buffer.byteLength(result.stdout)
    if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
      throw new Error(`Review tool output limit exceeded (${MAX_TOOL_OUTPUT_BYTES} bytes)`)
    }
    return result.stdout
  }

  const readParameters = Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })),
    },
    { additionalProperties: false }
  )
  const searchParameters = Type.Object(
    {
      pattern: Type.String({ minLength: 1, maxLength: 1_000 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      glob: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
      ignore_case: Type.Optional(Type.Boolean()),
      literal: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false }
  )
  const findParameters = Type.Object(
    {
      pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
    },
    { additionalProperties: false }
  )
  const listParameters = Type.Object(
    {
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false }
  )
  const changedFilesParameters = Type.Object(
    {
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false }
  )
  const fileDiffParameters = Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    },
    { additionalProperties: false }
  )

  const tools = [
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.read,
      label: 'Read repository file',
      description: 'Read a bounded range of a repository file with line numbers.',
      parameters: readParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('read', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.search,
      label: 'Search repository',
      description: 'Search repository file contents with a bounded ripgrep query.',
      parameters: searchParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('search', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.find,
      label: 'Find repository files',
      description: 'List bounded repository file paths, optionally filtered by a glob.',
      parameters: findParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('find', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.list,
      label: 'List repository directory',
      description: 'List a bounded number of entries in a repository directory.',
      parameters: listParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('list', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.changed,
      label: 'List changed files',
      description:
        'List exact changed filenames from the pinned diff. Follow next_offset until it is null.',
      parameters: changedFilesParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [
          {
            type: 'text',
            text: await runOperation(
              'list_changed_files',
              { ...args, base_sha: baseSha, head_sha: headSha },
              signal
            ),
          },
        ],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.diff,
      label: 'Read file diff',
      description:
        'Read a page of the pinned diff for one exact changed filename. Follow next_offset until it is null.',
      parameters: fileDiffParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [
          {
            type: 'text',
            text: await runOperation(
              'read_file_diff',
              { ...args, base_sha: baseSha, head_sha: headSha },
              signal
            ),
          },
        ],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.submit,
      label: 'Submit review findings',
      description:
        'Finish the review with one markdown summary and optional inline comments on exact diff lines.',
      parameters: reviewFindingsSchema,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => {
        if (findings) throw new Error('Review findings were already submitted')
        const parsed = parseReviewFindings(args)
        const coordinates = parsed.comments.map(({ body: _body, ...coordinate }) => coordinate)
        await runOperation(
          'validate_comments',
          { base_sha: baseSha, head_sha: headSha, comments: coordinates },
          signal
        )
        findings = parsed
        return {
          content: [{ type: 'text', text: 'Review findings captured.' }],
          details: undefined,
          terminate: true,
        }
      },
    }),
  ]

  return {
    tools,
    getFindings: () => findings,
  }
}
