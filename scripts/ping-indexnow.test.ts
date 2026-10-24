import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectIndexNowUrls } from './ping-indexnow'

const LIBRARY = 'apps/sim/content/library'
const COMPETITORS = 'apps/sim/lib/compare/data/competitors'
const repos: string[] = []

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function write(repo: string, file: string, content: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}

function post(draft = false): string {
  return `---\nslug: x\ntitle: A post\ndraft: ${draft}\n---\n\nBody\n`
}

function commit(repo: string): string {
  git(repo, 'add', '-A')
  git(
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'c',
    '--allow-empty'
  )
  return git(repo, 'rev-parse', 'HEAD')
}

/** A real repository with one published post, one draft, and two competitors at its base commit. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'indexnow-'))
  repos.push(repo)
  git(repo, 'init', '-q')
  write(repo, `${LIBRARY}/published/index.mdx`, post())
  write(repo, `${LIBRARY}/hidden/index.mdx`, post(true))
  write(repo, `${COMPETITORS}/n8n.ts`, "export const p = {\n  id: 'n8n',\n}\n")
  write(repo, `${COMPETITORS}/stackai.ts`, "export const p = {\n  id: 'stack-ai',\n}\n")
  write(repo, 'apps/sim/lib/compare/data/sim.ts', 'export const sim = 1\n')
  write(repo, 'README.md', 'readme\n')
  const base = commit(repo)
  return { repo, base, urls: () => collectIndexNowUrls(repo, base, commit(repo)) }
}

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true })
})

describe('collectIndexNowUrls', () => {
  it('submits an edited published post and the library index', () => {
    const { repo, urls } = fixture()
    write(repo, `${LIBRARY}/published/cover.jpg`, 'new image')
    expect(urls()).toEqual(['https://www.sim.ai/library', 'https://www.sim.ai/library/published'])
  })

  it('never submits a draft', () => {
    const { repo, urls } = fixture()
    write(repo, `${LIBRARY}/hidden/index.mdx`, `${post(true)}more\n`)
    expect(urls()).toEqual([])
  })

  it('submits a renamed post under its old and new slug, and never a deleted draft', () => {
    const { repo, urls } = fixture()
    git(repo, 'mv', `${LIBRARY}/published`, `${LIBRARY}/renamed`)
    git(repo, 'rm', '-rq', `${LIBRARY}/hidden`)
    expect(urls()).toEqual([
      'https://www.sim.ai/library',
      'https://www.sim.ai/library/published',
      'https://www.sim.ai/library/renamed',
    ])
  })

  it('names a comparison by its profile id, not its file name', () => {
    const { repo, urls } = fixture()
    write(repo, `${COMPETITORS}/stackai.ts`, "export const p = {\n  id: 'stack-ai',\n  x: 1,\n}\n")
    expect(urls()).toEqual([
      'https://www.sim.ai/comparisons',
      'https://www.sim.ai/comparisons/stack-ai',
    ])
  })

  it("submits every comparison when Sim's own profile changes", () => {
    const { repo, urls } = fixture()
    write(repo, 'apps/sim/lib/compare/data/sim.ts', 'export const sim = 2\n')
    expect(urls()).toEqual([
      'https://www.sim.ai/comparisons',
      'https://www.sim.ai/comparisons/n8n',
      'https://www.sim.ai/comparisons/stack-ai',
    ])
  })

  it('submits a post that went from published to draft, since it now 404s', () => {
    const { repo, urls } = fixture()
    write(repo, `${LIBRARY}/published/index.mdx`, post(true))
    expect(urls()).toEqual(['https://www.sim.ai/library', 'https://www.sim.ai/library/published'])
  })

  it('submits both the old and new URL when a comparison id changes', () => {
    const { repo, urls } = fixture()
    write(repo, `${COMPETITORS}/n8n.ts`, "export const p = {\n  id: 'n8n-io',\n}\n")
    expect(urls()).toEqual([
      'https://www.sim.ai/comparisons',
      'https://www.sim.ai/comparisons/n8n',
      'https://www.sim.ai/comparisons/n8n-io',
    ])
  })

  it("keeps a deleted comparison when Sim's profile changes in the same release", () => {
    const { repo, urls } = fixture()
    write(repo, 'apps/sim/lib/compare/data/sim.ts', 'export const sim = 2\n')
    git(repo, 'rm', '-q', `${COMPETITORS}/n8n.ts`)
    expect(urls()).toEqual([
      'https://www.sim.ai/comparisons',
      'https://www.sim.ai/comparisons/n8n',
      'https://www.sim.ai/comparisons/stack-ai',
    ])
  })

  it('submits nothing when no library or comparison source changed', () => {
    const { repo, urls } = fixture()
    write(repo, 'README.md', 'changed\n')
    write(repo, `${LIBRARY}/notes.md`, 'not a post\n')
    expect(urls()).toEqual([])
  })
})
