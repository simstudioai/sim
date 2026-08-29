/**
 * @vitest-environment node
 *
 * End-to-end file I/O against a real sandbox provider.
 *
 * The conformance suite proves both adapters agree on a mocked SDK; this proves
 * the contract survives the actual provider — that a mount really lands where
 * the code expects, that the output directory really exists before user code
 * runs, and that harvested bytes really come back unchanged.
 *
 * Enable with `SANDBOX_FILES_SMOKE=1`. Requires `E2B_API_KEY` and
 * `E2B_FUNCTION_TEMPLATE_ID`; set `SANDBOX_PROVIDER=daytona` (with
 * `DAYTONA_API_KEY` and `DAYTONA_SHELL_SNAPSHOT_ID`) to run the same table
 * against Daytona instead. Each case creates and destroys one sandbox.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  executeInSandbox,
  executeShellInSandbox,
  SIM_RESULT_PREFIX,
} from '@/lib/execution/remote-sandbox'
import { SANDBOX_INPUT_DIR, SANDBOX_OUTPUT_DIR } from '@/lib/execution/remote-sandbox/sandbox-paths'

const smokeEnabled = process.env.SANDBOX_FILES_SMOKE === '1'
const CASE_TIMEOUT_MS = 5 * 60_000
const RUN_TIMEOUT_MS = 4 * 60_000

/** Bytes that a UTF-8 round trip would destroy — the corruption we must not see. */
const BINARY_FIXTURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0xc3, 0x28,
])

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function decode(contentBase64: string): Buffer {
  return Buffer.from(contentBase64, 'base64')
}

/**
 * Emits the result marker by hand. These cases drive the sandbox layer directly,
 * below the wrapper `execute-request` builds, so `__sim_result__` and a bare
 * `return` are not available here — the marker is what proves the code ran to
 * completion rather than dying partway.
 */
function pythonResult(expression: string): string {
  return `import json; print('${SIM_RESULT_PREFIX}' + json.dumps(${expression}))`
}

function javascriptResult(expression: string): string {
  return `console.log('\\n${SIM_RESULT_PREFIX}' + JSON.stringify(${expression}))`
}

describe.skipIf(!smokeEnabled)('sandbox file I/O smoke', () => {
  it(
    'mounts inputs, harvests outputs, and preserves binary bytes exactly',
    async () => {
      const result = await executeInSandbox({
        code: [
          'import os, shutil',
          `text = open(os.path.join(${JSON.stringify(SANDBOX_INPUT_DIR)}, 'notes.txt')).read()`,
          `blob = open(os.path.join(${JSON.stringify(SANDBOX_INPUT_DIR)}, 'fixture.bin'), 'rb').read()`,
          `out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
          "open(os.path.join(out, 'echo.txt'), 'w').write(text.upper())",
          // Copied byte-for-byte so any encoding mistake anywhere in the round
          // trip shows up as a hash mismatch rather than a plausible-looking file.
          "open(os.path.join(out, 'copy.bin'), 'wb').write(blob)",
          "os.makedirs(os.path.join(out, 'nested'), exist_ok=True)",
          "open(os.path.join(out, 'nested', 'deep.txt'), 'w').write('nested')",
          "open(os.path.join(out, 'empty.txt'), 'w').write('')",
          pythonResult('{"len": len(blob)}'),
        ].join('\n'),
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        sandboxFiles: [
          { path: `${SANDBOX_INPUT_DIR}/notes.txt`, content: 'hello sandbox' },
          {
            path: `${SANDBOX_INPUT_DIR}/fixture.bin`,
            content: BINARY_FIXTURE.toString('base64'),
            encoding: 'base64',
          },
        ],
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({ len: BINARY_FIXTURE.length })

      const byPath = new Map((result.collectedFiles ?? []).map((file) => [file.relativePath, file]))
      expect([...byPath.keys()].sort()).toEqual([
        'copy.bin',
        'echo.txt',
        'empty.txt',
        'nested/deep.txt',
      ])

      expect(decode(byPath.get('echo.txt')!.contentBase64).toString('utf8')).toBe('HELLO SANDBOX')
      expect(sha256(decode(byPath.get('copy.bin')!.contentBase64))).toBe(sha256(BINARY_FIXTURE))
      expect(byPath.get('copy.bin')!.byteLength).toBe(BINARY_FIXTURE.length)
      expect(decode(byPath.get('nested/deep.txt')!.contentBase64).toString('utf8')).toBe('nested')
      expect(byPath.get('empty.txt')!.byteLength).toBe(0)
    },
    CASE_TIMEOUT_MS
  )

  it(
    'reads a mounted file and creates the output directory before JavaScript user code runs',
    async () => {
      const result = await executeInSandbox({
        code: [
          "import { readFileSync, writeFileSync, existsSync } from 'node:fs'",
          `const out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
          // Asserted from inside the sandbox: if the directory were not created
          // before user code, the very first write is ENOENT.
          'if (!existsSync(out)) throw new Error("output dir missing before user code")',
          // The point of resolving `<block.file.path>` to a path rather than
          // inlining bytes is that every language can just open it. Python and
          // Shell prove that in the cases either side of this one.
          `const seed = readFileSync(${JSON.stringify(`${SANDBOX_INPUT_DIR}/seed.txt`)}, 'utf8')`,
          'writeFileSync(out + "/from-js.json", JSON.stringify({ seed }))',
          javascriptResult('{ wrote: true }'),
        ].join('\n'),
        language: CodeLanguage.JavaScript,
        timeoutMs: RUN_TIMEOUT_MS,
        sandboxFiles: [{ path: `${SANDBOX_INPUT_DIR}/seed.txt`, content: 'js seed' }],
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      expect(result.collectedFiles).toHaveLength(1)
      expect(result.collectedFiles?.[0].relativePath).toBe('from-js.json')
      expect(JSON.parse(decode(result.collectedFiles![0].contentBase64).toString('utf8'))).toEqual({
        seed: 'js seed',
      })
    },
    CASE_TIMEOUT_MS
  )

  it(
    'creates the output directory before shell user code runs',
    async () => {
      const result = await executeShellInSandbox({
        code: [
          `test -d ${SANDBOX_OUTPUT_DIR} || { echo "output dir missing" >&2; exit 1; }`,
          `cp ${SANDBOX_INPUT_DIR}/seed.txt ${SANDBOX_OUTPUT_DIR}/from-shell.txt`,
          'echo "__SIM_RESULT__=\\"done\\""',
        ].join('\n'),
        envs: {},
        timeoutMs: RUN_TIMEOUT_MS,
        sandboxFiles: [{ path: `${SANDBOX_INPUT_DIR}/seed.txt`, content: 'shell seed' }],
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      expect(result.collectedFiles).toHaveLength(1)
      expect(decode(result.collectedFiles![0].contentBase64).toString('utf8')).toBe('shell seed')
    },
    CASE_TIMEOUT_MS
  )

  it(
    'returns nothing rather than failing when the code writes no files',
    async () => {
      const result = await executeInSandbox({
        code: pythonResult('"no files"'),
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      expect(result.result).toBe('no files')
      // "Produced nothing" is an ordinary outcome; the directory exists because
      // the prologue made it, so listing it must succeed and come back empty.
      expect(result.collectedFiles).toBeUndefined()
    },
    CASE_TIMEOUT_MS
  )

  it(
    'skips directories and follows symlinks identically on either provider',
    async () => {
      const result = await executeInSandbox({
        code: [
          'import os',
          `out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
          "open(os.path.join(out, 'real.txt'), 'w').write('real')",
          "os.symlink('/etc/passwd', os.path.join(out, 'linked.txt'))",
          "os.makedirs(os.path.join(out, 'adir'), exist_ok=True)",
          pythonResult('"planted"'),
        ].join('\n'),
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      // Followed rather than excluded, and the same on both providers — Daytona
      // resolves links in its listing with no field that would reveal one, and
      // the code could copy the target's bytes into the directory itself
      // anyway. The empty directory is skipped on both.
      expect((result.collectedFiles ?? []).map((file) => file.relativePath).sort()).toEqual([
        'linked.txt',
        'real.txt',
      ])
    },
    CASE_TIMEOUT_MS
  )

  it(
    'refuses a harvest over the file-count limit instead of truncating it',
    async () => {
      await expect(
        executeInSandbox({
          code: [
            'import os',
            `out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
            'for i in range(21):',
            "    open(os.path.join(out, f'file-{i}.txt'), 'w').write(str(i))",
            pythonResult('"wrote 21"'),
          ].join('\n'),
          language: CodeLanguage.Python,
          timeoutMs: RUN_TIMEOUT_MS,
          outputSandboxDir: SANDBOX_OUTPUT_DIR,
        })
      ).rejects.toThrow(/over the 20-file export limit/)
    },
    CASE_TIMEOUT_MS
  )

  it(
    'probe: how deep a nested output is still harvested',
    async () => {
      const result = await executeInSandbox({
        code: [
          'import os',
          `out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
          'for depth in range(1, 6):',
          "    d = os.path.join(out, *[f'l{i}' for i in range(1, depth + 1)])",
          '    os.makedirs(d, exist_ok=True)',
          "    open(os.path.join(d, 'leaf.txt'), 'w').write(str(depth))",
          pythonResult('"nested"'),
        ].join('\n'),
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      // Nesting deeper than the listing depth must not vanish silently — losing
      // a file the code successfully wrote is worse than refusing the harvest.
      expect((result.collectedFiles ?? []).map((file) => file.relativePath).sort()).toEqual([
        'l1/l2/l3/l4/l5/leaf.txt',
        'l1/l2/l3/l4/leaf.txt',
        'l1/l2/l3/leaf.txt',
        'l1/l2/leaf.txt',
        'l1/leaf.txt',
      ])
    },
    CASE_TIMEOUT_MS
  )

  it(
    'probe: a file name containing a newline survives the listing',
    async () => {
      const result = await executeInSandbox({
        code: [
          'import os',
          `out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
          `open(os.path.join(out, 'we\\nird.txt'), 'w').write('newline name')`,
          pythonResult('"newline"'),
        ].join('\n'),
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      // A structured listing has no delimiter to corrupt, unlike the `find`
      // manifest this deliberately avoids.
      expect(result.collectedFiles).toHaveLength(1)
      expect(decode(result.collectedFiles![0].contentBase64).toString('utf8')).toBe('newline name')
    },
    CASE_TIMEOUT_MS
  )

  it(
    'names the cause when user code deletes the output directory',
    async () => {
      await expect(
        executeInSandbox({
          code: [
            'import shutil',
            `shutil.rmtree(${JSON.stringify(SANDBOX_OUTPUT_DIR)})`,
            pythonResult('"deleted"'),
          ].join('\n'),
          language: CodeLanguage.Python,
          timeoutMs: RUN_TIMEOUT_MS,
          outputSandboxDir: SANDBOX_OUTPUT_DIR,
        })
        // Without this the caller sees a raw `lstat ... no such file or
        // directory`, which reads like a platform fault rather than their own
        // `rmtree`.
      ).rejects.toThrow(/no longer exists — the code deleted it/)
    },
    CASE_TIMEOUT_MS
  )

  it(
    'round-trips awkward file names',
    async () => {
      const result = await executeInSandbox({
        code: [
          'import os',
          `out = ${JSON.stringify(SANDBOX_OUTPUT_DIR)}`,
          "open(os.path.join(out, 'Q4 Sales (Final).csv'), 'w').write('a,b')",
          "open(os.path.join(out, 'rapport-café.txt'), 'w', encoding='utf-8').write('café')",
          "open(os.path.join(out, 'archive.tar.gz'), 'wb').write(b'\\x1f\\x8b\\x08')",
          "open(os.path.join(out, 'noext'), 'wb').write(b'\\x00\\x01\\x02')",
          pythonResult('"named"'),
        ].join('\n'),
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        outputSandboxDir: SANDBOX_OUTPUT_DIR,
      })

      expect(result.error).toBeUndefined()
      const byPath = new Map((result.collectedFiles ?? []).map((file) => [file.relativePath, file]))
      expect([...byPath.keys()].sort()).toEqual([
        'Q4 Sales (Final).csv',
        'archive.tar.gz',
        'noext',
        'rapport-café.txt',
      ])
      // Extension-less and gzip content must survive: neither is in the
      // allowlist that decides encoding for a declared output path.
      expect(decode(byPath.get('noext')!.contentBase64)).toEqual(Buffer.from([0, 1, 2]))
      expect(decode(byPath.get('archive.tar.gz')!.contentBase64)).toEqual(
        Buffer.from([0x1f, 0x8b, 0x08])
      )
      expect(decode(byPath.get('rapport-café.txt')!.contentBase64).toString('utf8')).toBe('café')
    },
    CASE_TIMEOUT_MS
  )
})
