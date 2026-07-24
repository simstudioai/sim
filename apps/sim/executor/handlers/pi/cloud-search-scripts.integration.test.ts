/**
 * @vitest-environment node
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { FINALIZER_BUILD_SCRIPT } from '@/executor/handlers/pi/cloud-search-backend'
import {
  BUILD_SEARCH_MANIFEST_SCRIPT,
  parseSearchChangeManifest,
} from '@/executor/handlers/pi/cloud-search-manifest'

const execFileAsync = promisify(execFile)
const directories: string[] = []

async function bash(script: string, env: Record<string, string> = {}) {
  return execFileAsync('/bin/bash', ['-c', script], {
    env: { ...process.env, ...env },
  })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('Pi search exporter and finalizer scripts', () => {
  it('exports bounded files under isolated Python and constructs a sole-parent commit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-search-scripts-'))
    directories.push(root)
    const repo = path.join(root, 'repo')
    const manifestPath = path.join(root, 'manifest.json')
    const commitPath = path.join(root, 'commit.txt')
    const diffPath = path.join(root, 'diff.patch')
    await mkdir(repo)
    await bash(
      `cd ${JSON.stringify(repo)} && git init -q && git config user.name Test && git config user.email test@example.com && printf 'base\\n' > file.txt && git add file.txt && git commit -qm base`
    )
    const { stdout: baseStdout } = await execFileAsync('git', ['-C', repo, 'rev-parse', 'HEAD'])
    const baseSha = baseStdout.trim()
    await writeFile(path.join(repo, 'file.txt'), 'changed\n')
    await writeFile(path.join(repo, 'base64.py'), 'raise RuntimeError("must not import repo")\n')

    const exporter = BUILD_SEARCH_MANIFEST_SCRIPT.replaceAll(
      '/workspace/pi-search-manifest.json',
      manifestPath
    )
      .replaceAll('/workspace/repo', repo)
      .replace('cd /workspace\n', `cd ${JSON.stringify(root)}\n`)
    await bash(exporter, { BASE_SHA: baseSha })
    const manifest = parseSearchChangeManifest(await readFile(manifestPath, 'utf8'))
    expect(manifest.writes.map((write) => write.path)).toEqual(['base64.py', 'file.txt'])

    await writeFile(commitPath, 'Pi: integration test')
    const finalizer = FINALIZER_BUILD_SCRIPT.replaceAll(
      '/workspace/pi-finalizer-manifest.json',
      manifestPath
    )
      .replaceAll('/workspace/pi-finalizer-commit.txt', commitPath)
      .replaceAll('/workspace/pi-finalizer.raw.diff', `${diffPath}.raw`)
      .replaceAll('/workspace/pi-finalizer.diff', diffPath)
      .replaceAll('/workspace/repo', repo)
    const { stdout } = await bash(finalizer, {
      BASE_SHA: baseSha,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    })
    const commitSha = /__COMMIT_SHA__=([0-9a-f]{40})/.exec(stdout)?.[1]
    expect(commitSha).toBeTruthy()
    const { stdout: parent } = await execFileAsync('git', [
      '-C',
      repo,
      'rev-parse',
      `${commitSha}^`,
    ])
    expect(parent.trim()).toBe(baseSha)
    const { stdout: committed } = await execFileAsync('git', [
      '-C',
      repo,
      'show',
      `${commitSha}:file.txt`,
    ])
    expect(committed).toBe('changed\n')
  })
})
