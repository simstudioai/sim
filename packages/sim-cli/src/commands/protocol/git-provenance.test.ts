import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitProvenance } from './git-provenance'

let root: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sim-git-provenance-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('gitProvenance', () => {
  it('names the checked-out commit and the origin remote without its credentials', async () => {
    git('init', '-q')
    git('config', 'user.email', 'source@example.invalid')
    git('config', 'user.name', 'Source')
    mkdirSync(join(root, 'workspace'))
    writeFileSync(join(root, 'workspace', 'secrets.ts'), '// @sim-sdk 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'workspace')
    git(
      'remote',
      'add',
      'origin',
      'https://x-access-token:ghp_secret@github.com/acme/flows.git?t=1'
    )

    const provenance = await gitProvenance(join(root, 'workspace'))

    expect(provenance).toEqual({
      gitSha: git('rev-parse', 'HEAD'),
      repo: 'https://github.com/acme/flows.git',
    })
  })

  it('keeps an scp-style remote, and sends no commit before the first one', async () => {
    git('init', '-q')
    git('remote', 'add', 'origin', 'git@github.com:acme/flows.git')

    expect(await gitProvenance(root)).toEqual({ repo: 'git@github.com:acme/flows.git' })
  })

  it('sends no remote the server would refuse as carrying credentials', async () => {
    git('init', '-q')
    git('remote', 'add', 'origin', 'git@github.com:acme/flows.git')
    for (const remote of [
      'https:/ghp_x@github.com/acme/flows.git',
      'deploy:secret@github.com:acme/flows.git',
      'git@github.com:acme/flows.git#ghp_x',
      '/srv/shared repos/flows.git',
    ]) {
      git('remote', 'set-url', 'origin', remote)

      expect(await gitProvenance(root)).toEqual({})
    }
  })

  it('sends nothing for a directory outside any repository', async () => {
    expect(await gitProvenance(root)).toEqual({})
  })
})
