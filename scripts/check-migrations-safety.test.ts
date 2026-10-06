import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/check-migrations-safety.ts')
let fixture: string

beforeAll(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), 'migration-safety-'))
  await mkdir(path.join(fixture, 'scripts'))
  await copyFile(SCRIPT, path.join(fixture, 'scripts/check-migrations-safety.ts'))
  await execFileAsync('git', ['init', '--quiet'], { cwd: fixture })
  await execFileAsync(
    'git',
    [
      '-c',
      'user.name=Migration test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'Initial fixture',
    ],
    { cwd: fixture }
  )
})

afterAll(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true })
})

async function runAudit(
  baseRef: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'bun',
      ['run', path.join(fixture, 'scripts/check-migrations-safety.ts'), baseRef],
      { cwd: fixture }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('migration safety audit', () => {
  /**
   * The regression this guards: an unresolvable base ref made `git diff` fail, the
   * failure was read as an empty file list, and the audit printed
   * `✓ No new migrations to check` and exited 0 — green on a branch it never read.
   * CI reached that state whenever its `git fetch ... || true` swallowed a failure.
   */
  it('fails loudly when the base ref cannot be diffed', async () => {
    const { code, stderr } = await runAudit('origin/branch-that-does-not-exist')

    expect(code).toBe(1)
    expect(stderr).toContain('could not run')
    expect(stderr).not.toContain('No new migrations to check')
  }, 30_000)

  it('passes against a real base ref with no new migrations', async () => {
    const { code, stdout } = await runAudit('HEAD')

    expect(code).toBe(0)
    expect(stdout).toContain('No new migrations to check')
  }, 30_000)
})
