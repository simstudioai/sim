/**
 * @vitest-environment node
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile as writeLocalFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as sdk from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PiSandboxRunner } from '@/lib/execution/e2b'
import {
  CLOUD_REVIEW_TOOL_NAMES,
  createCloudReviewTools,
  installCloudReviewTools,
} from '@/executor/handlers/pi/cloud-review-tools'

const BASE_SHA = 'b'.repeat(40)
const HEAD_SHA = 'a'.repeat(40)
const execFileAsync = promisify(execFile)

describe('cloud review tools', () => {
  const run = vi.fn()
  const writeFile = vi.fn()
  const runner: PiSandboxRunner = {
    run,
    readFile: vi.fn(),
    writeFile,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    run.mockImplementation(
      (_command: string, options: { envs?: Record<string, string>; timeoutMs: number }) => {
        const operation = options.envs?.REVIEW_TOOL_OPERATION
        if (operation === 'validate_comments') {
          return Promise.resolve({
            stdout: 'Review coordinates are valid',
            stderr: '',
            exitCode: 0,
          })
        }
        return Promise.resolve({ stdout: 'tool output', stderr: '', exitCode: 0 })
      }
    )
  })

  it('installs a fixed helper outside the untrusted checkout', async () => {
    await installCloudReviewTools(runner)

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, source] = writeFile.mock.calls[0]
    expect(path).toBe('/workspace/sim-review-tools.py')
    expect(path).not.toContain('/workspace/repo/')
    expect(source).toContain("ROOT = pathlib.Path('/workspace/repo').resolve()")
    expect(source).not.toContain('REVIEW_REPO_ROOT')
    expect(source).toContain("value.is_absolute() or '..' in value.parts")
    expect(source).toContain("value.parts[0] == '.git'")
    expect(source).toContain('MAX_OUTPUT_BYTES = 50_000')
    expect(source).toContain('COMMENTABLE_DIFF_CONTEXT = 3')
    expect(source).not.toContain('--unified=20')
  })

  it('enforces read-size and canonical path bounds in the actual helper', async () => {
    await installCloudReviewTools(runner)
    const source = writeFile.mock.calls[0][1] as string
    const testDir = await mkdtemp(join(tmpdir(), 'sim-review-tools-'))
    const repoDir = join(testDir, 'repo')
    const scriptPath = join(testDir, 'review-tools.py')
    const outsidePath = join(testDir, 'outside.txt')

    try {
      await mkdir(repoDir)
      await writeLocalFile(
        scriptPath,
        source.replace(
          "pathlib.Path('/workspace/repo')",
          `pathlib.Path(${JSON.stringify(repoDir)})`
        )
      )
      await writeLocalFile(join(repoDir, 'safe.txt'), 'one\ntwo\n')
      await writeLocalFile(outsidePath, 'secret')
      await symlink(outsidePath, join(repoDir, 'escape.txt'))
      await mkdir(join(repoDir, '.git'))
      await writeLocalFile(join(repoDir, '.git', 'secret.txt'), 'DO_NOT_EXPOSE')

      const execute = (operation: string, args: Record<string, unknown>) =>
        execFileAsync('python3', [scriptPath], {
          env: {
            ...process.env,
            REVIEW_TOOL_OPERATION: operation,
            REVIEW_TOOL_ARGS: JSON.stringify(args),
          },
        })

      await expect(
        execute('read', { path: 'safe.txt', offset: 1, limit: 2 })
      ).resolves.toMatchObject({
        stdout: '1: one\n2: two',
      })
      await expect(execute('read', { path: '../outside.txt' })).rejects.toMatchObject({
        stderr: expect.stringContaining('path must stay within the repository'),
      })
      await expect(execute('read', { path: 'escape.txt' })).rejects.toMatchObject({
        stderr: expect.stringContaining('path resolves outside the repository'),
      })

      const found = await execute('find', { path: '.', pattern: '**/*', limit: 20 })
      expect(found.stdout).toContain('safe.txt')
      expect(found.stdout).not.toContain('.git')
      const searched = await execute('search', {
        path: '.',
        pattern: 'DO_NOT_EXPOSE',
        glob: '**/*',
        literal: true,
      })
      expect(searched.stdout).toBe('No matches found')

      await writeLocalFile(join(repoDir, 'large.bin'), Buffer.alloc(5_000_001))
      await expect(execute('read', { path: 'large.bin' })).rejects.toMatchObject({
        stderr: expect.stringContaining('exceeds the 5 MB read limit'),
      })
    } finally {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  it('validates inline coordinates against an exact local diff', async () => {
    await installCloudReviewTools(runner)
    const source = writeFile.mock.calls[0][1] as string
    const testDir = await mkdtemp(join(tmpdir(), 'sim-review-diff-'))
    const repoDir = join(testDir, 'repo')
    const scriptPath = join(testDir, 'review-tools.py')
    const git = (args: string[]) => execFileAsync('git', args, { cwd: repoDir })

    try {
      await mkdir(repoDir)
      await writeLocalFile(
        scriptPath,
        source.replace(
          "pathlib.Path('/workspace/repo')",
          `pathlib.Path(${JSON.stringify(repoDir)})`
        )
      )
      await git(['init'])
      await git(['config', 'user.email', 'review@example.com'])
      await git(['config', 'user.name', 'Review Test'])
      await writeLocalFile(join(repoDir, 'a.ts'), 'const one = 1\nconst two = 2\n')
      await writeLocalFile(join(repoDir, ':(glob)magic.ts'), 'const value = 1\n')
      await writeLocalFile(join(repoDir, 'old.ts'), 'one\ntwo\nthree\n')
      const rangeLines = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`)
      await writeLocalFile(join(repoDir, 'ranges.ts'), `${rangeLines.join('\n')}\n`)
      await git(['add', 'a.ts', 'old.ts', 'ranges.ts'])
      await git(['--literal-pathspecs', 'add', '--', ':(glob)magic.ts'])
      await git(['commit', '-m', 'base'])
      const baseSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()
      await writeLocalFile(join(repoDir, 'a.ts'), 'const one = 1\nconst two = 3\n')
      await writeLocalFile(join(repoDir, ':(glob)magic.ts'), 'const value = 2\n')
      await git(['mv', 'old.ts', 'new.ts'])
      await writeLocalFile(join(repoDir, 'new.ts'), 'one\nTWO\nthree\n')
      const updatedRangeLines = [...rangeLines]
      updatedRangeLines[1] = 'changed 2'
      updatedRangeLines[2] = 'changed 3'
      updatedRangeLines[17] = 'changed 18'
      updatedRangeLines[18] = 'changed 19'
      await writeLocalFile(join(repoDir, 'ranges.ts'), `${updatedRangeLines.join('\n')}\n`)
      await git(['add', 'a.ts', 'new.ts', 'ranges.ts'])
      await git(['--literal-pathspecs', 'add', '--', ':(glob)magic.ts'])
      await git(['commit', '-m', 'head'])
      const headSha = (await git(['rev-parse', 'HEAD'])).stdout.trim()

      const executeHelper = (operation: string, args: Record<string, unknown>) =>
        execFileAsync('python3', [scriptPath], {
          env: {
            ...process.env,
            REVIEW_TOOL_OPERATION: operation,
            REVIEW_TOOL_ARGS: JSON.stringify(args),
          },
        })
      const execute = (line: number, path = 'a.ts', side = 'RIGHT') =>
        executeHelper('validate_comments', {
          base_sha: baseSha,
          head_sha: headSha,
          comments: [{ path, body: 'Finding', line, side }],
        })
      const executeMultiline = (startLine: number, line: number, side = 'RIGHT') =>
        executeHelper('validate_comments', {
          base_sha: baseSha,
          head_sha: headSha,
          comments: [
            {
              path: 'ranges.ts',
              body: 'Finding',
              start_line: startLine,
              start_side: side,
              line,
              side,
            },
          ],
        })

      await expect(execute(2)).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(execute(1, ':(glob)magic.ts')).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(execute(2, 'new.ts', 'LEFT')).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(execute(2, 'new.ts', 'RIGHT')).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(execute(1, 'a.ts', 'LEFT')).rejects.toMatchObject({
        stderr: expect.stringContaining('line is not on the requested diff side'),
      })
      await expect(execute(1, 'a.ts', 'RIGHT')).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(executeMultiline(2, 3)).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(executeMultiline(2, 3, 'LEFT')).resolves.toMatchObject({
        stdout: 'Review coordinates are valid',
      })
      await expect(executeMultiline(2, 18)).rejects.toMatchObject({
        stderr: expect.stringContaining('multiline range must stay in one diff hunk'),
      })
      await expect(execute(99)).rejects.toMatchObject({
        stderr: expect.stringContaining('line is not on the requested diff side'),
      })

      const firstChangedPage = await executeHelper('list_changed_files', {
        base_sha: baseSha,
        head_sha: headSha,
        offset: 0,
        limit: 2,
      })
      const firstPage = JSON.parse(firstChangedPage.stdout) as {
        files: string[]
        next_offset: number | null
      }
      expect(firstPage.next_offset).toBe(2)
      const finalChangedPage = await executeHelper('list_changed_files', {
        base_sha: baseSha,
        head_sha: headSha,
        offset: firstPage.next_offset,
        limit: 20,
      })
      const finalPage = JSON.parse(finalChangedPage.stdout) as {
        files: string[]
        next_offset: number | null
      }
      expect([...firstPage.files, ...finalPage.files]).toEqual(
        expect.arrayContaining([':(glob)magic.ts', 'a.ts', 'new.ts', 'ranges.ts'])
      )
      expect(finalPage).toMatchObject({
        next_offset: null,
      })

      const renamedDiff = await executeHelper('read_file_diff', {
        base_sha: baseSha,
        head_sha: headSha,
        path: 'new.ts',
        offset: 0,
        limit: 100,
      })
      const page = JSON.parse(renamedDiff.stdout) as { diff: string; next_offset: number | null }
      expect(page.diff).toContain('rename from old.ts')
      expect(page.diff).toContain('-two')
      expect(page.diff).toContain('+TWO')
      expect(page.next_offset).toBeNull()
    } finally {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  it('exposes only the explicit review allowlist', () => {
    const reviewTools = createCloudReviewTools(sdk, runner, BASE_SHA, HEAD_SHA)
    expect(reviewTools.tools.map((tool) => tool.name)).toEqual(CLOUD_REVIEW_TOOL_NAMES)
    expect(reviewTools.tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['bash', 'write', 'edit'])
    )
    expect(reviewTools.tools.every((tool) => tool.executionMode === 'sequential')).toBe(true)
  })

  it('passes hostile values through JSON envs without interpolating the command', async () => {
    const reviewTools = createCloudReviewTools(sdk, runner, BASE_SHA, HEAD_SHA)
    const readTool = reviewTools.tools.find((tool) => tool.name === 'read_repo_file')
    expect(readTool).toBeDefined()

    await readTool!.execute(
      'call-1',
      { path: '../x; echo $SECRET', offset: 1, limit: 10 },
      undefined,
      undefined,
      {} as never
    )

    const [command, options] = run.mock.calls[0]
    expect(command).toBe('python3 /workspace/sim-review-tools.py')
    expect(command).not.toContain('../x')
    expect(options.envs).toEqual({
      REVIEW_TOOL_OPERATION: 'read',
      REVIEW_TOOL_ARGS: JSON.stringify({
        path: '../x; echo $SECRET',
        offset: 1,
        limit: 10,
      }),
    })
    expect(JSON.stringify(options.envs)).not.toContain('sk-byok')
    expect(JSON.stringify(options.envs)).not.toContain('ghp_')
  })

  it('rejects malformed structured findings without calling the sandbox validator', async () => {
    const reviewTools = createCloudReviewTools(sdk, runner, BASE_SHA, HEAD_SHA)
    const submitTool = reviewTools.tools.find((tool) => tool.name === 'submit_review')
    expect(submitTool).toBeDefined()

    await expect(
      submitTool!.execute(
        'call-1',
        {
          body: 'Summary',
          comments: [{ path: 'a.ts', body: 'x', line: '12', side: 'RIGHT' }],
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/comments/)
    expect(run).not.toHaveBeenCalled()
    expect(reviewTools.getFindings()).toBeUndefined()
  })

  it('captures one validated review and terminates the agent', async () => {
    const reviewTools = createCloudReviewTools(sdk, runner, BASE_SHA, HEAD_SHA)
    const submitTool = reviewTools.tools.find((tool) => tool.name === 'submit_review')
    const findings = {
      body: 'Summary',
      comments: [{ path: 'a.ts', body: 'Fix this', line: 12, side: 'RIGHT' as const }],
    }

    const result = await submitTool!.execute('call-1', findings, undefined, undefined, {} as never)

    expect(result).toMatchObject({ terminate: true })
    expect(reviewTools.getFindings()).toEqual(findings)
    expect(run).toHaveBeenCalledWith(
      'python3 /workspace/sim-review-tools.py',
      expect.objectContaining({
        envs: {
          REVIEW_TOOL_OPERATION: 'validate_comments',
          REVIEW_TOOL_ARGS: JSON.stringify({
            base_sha: BASE_SHA,
            head_sha: HEAD_SHA,
            comments: [{ path: 'a.ts', line: 12, side: 'RIGHT' }],
          }),
        },
      })
    )
    await expect(
      submitTool!.execute('call-2', findings, undefined, undefined, {} as never)
    ).rejects.toThrow(/already submitted/)
  })

  it('does not capture findings when diff-coordinate validation fails', async () => {
    run.mockResolvedValue({
      stdout: '',
      stderr: 'comments[0] line is not on the diff',
      exitCode: 2,
    })
    const reviewTools = createCloudReviewTools(sdk, runner, BASE_SHA, HEAD_SHA)
    const submitTool = reviewTools.tools.find((tool) => tool.name === 'submit_review')

    await expect(
      submitTool!.execute(
        'call-1',
        {
          body: 'Summary',
          comments: [{ path: 'a.ts', body: 'Fix this', line: 999, side: 'RIGHT' }],
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/not on the diff/)
    expect(reviewTools.getFindings()).toBeUndefined()
  })
})
