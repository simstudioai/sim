import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(import.meta.dirname, 'create-single-release.ts')

interface VersionCommit {
  hash: string
  version: string
  title: string
  date: string
  author: string
}

interface ReleaseLookup {
  current: VersionCommit | null
  previous: VersionCommit | null
}

describe('release commit lookup', () => {
  let directory: string
  let tree: string
  let head: string

  function git(args: string[], input?: string): string {
    return execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      input,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Release Author',
        GIT_AUTHOR_EMAIL: 'release@example.com',
        GIT_COMMITTER_NAME: 'Release Author',
        GIT_COMMITTER_EMAIL: 'release@example.com',
      },
    }).trim()
  }

  function commit(message: string, parents = head ? [head] : []): string {
    head = git(['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])], message)
    git(['update-ref', 'refs/heads/main', head])
    return head
  }

  function lookup(version: string, commitSha = ''): ReleaseLookup {
    const output = execFileSync(
      'bun',
      [
        '--no-env-file',
        '--eval',
        `import { findVersionCommit, findPreviousVersionCommit } from ${JSON.stringify(SCRIPT)};
        const current = findVersionCommit(${JSON.stringify(version)});
        const previous = current ? findPreviousVersionCommit(current) : null;
        process.stdout.write(JSON.stringify({ current, previous }));`,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, GH_PAT: '', GITHUB_SHA: commitSha, LOG_LEVEL: 'ERROR' },
      }
    )
    return JSON.parse(output)
  }

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'sim-release-test-'))
    head = ''
    git(['init', '--initial-branch=main', '--quiet'])
    tree = git(['mktree'], '')
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('finds the release boundaries when older history exceeds the subprocess buffer', () => {
    for (let index = 0; index < 40; index++) {
      commit(`chore: historical change ${index} ${'x'.repeat(32_000)}`)
    }
    const previous = commit('v0.8.30: previous release')
    commit('fix(search): improve indexing (#7720)')
    const current = commit('v0.8.31: current release')

    expect(() => git(['log', '--format=%H|%s|%ai|%an', 'main'])).toThrow(/ENOBUFS/)
    expect(lookup('v0.8.31')).toMatchObject({
      current: { hash: current, version: 'v0.8.31' },
      previous: { hash: previous, version: 'v0.8.30' },
    })
  })

  it('uses the CI commit when main has advanced and HEAD is detached', () => {
    const previous = commit('v0.8.30: previous release')
    const current = commit('v0.8.31: current release')
    commit('v0.8.32: later release')
    git(['checkout', '--detach', '--quiet', current])
    git(['branch', '-D', 'main'])

    expect(lookup('v0.8.31', current)).toMatchObject({
      current: { hash: current },
      previous: { hash: previous },
    })
  })

  it('rejects a CI commit whose version differs from the requested release', () => {
    commit('v0.8.30: previous release')
    const current = commit('v0.8.31: current release')

    expect(lookup('v0.8.30', current)).toEqual({ current: null, previous: null })
  })

  it('supports looking up an older release on main', () => {
    const previous = commit('v0.8.30: previous release')
    const current = commit('v0.8.31: current release')
    commit('v0.8.32: later release')

    expect(lookup('v0.8.31')).toMatchObject({
      current: { hash: current },
      previous: { hash: previous },
    })
  })

  it('ignores release-like commit bodies and releases merged from another branch', () => {
    const previous = commit('v0.8.30: previous release')
    const sideRelease = commit('v9.0.0: release on staging', [previous])
    const mainCommit = commit('chore: mention a version\n\nv8.0.0: not a release', [previous])
    const current = commit('v0.8.31: current release', [mainCommit, sideRelease])
    commit('v0.8.32: later release\n\nv0.8.31: mentioned in the body')

    expect(lookup('v0.8.31')).toMatchObject({
      current: { hash: current },
      previous: { hash: previous },
    })
  })

  it('preserves pipe characters in release titles', () => {
    const current = commit('v0.8.31: parsers | search improvements')

    expect(lookup('v0.8.31')).toMatchObject({
      current: { hash: current, title: 'parsers | search improvements', author: 'Release Author' },
      previous: null,
    })
  })

  it('returns no match for a missing version or a similar version number', () => {
    commit('v0.8.310: a different version')

    expect(lookup('v0.8.31')).toEqual({ current: null, previous: null })
  })
})
