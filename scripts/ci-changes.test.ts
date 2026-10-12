import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../.github/scripts/ci-changes.sh', import.meta.url))
const fixtures: string[] = []

type Flags = Record<'full' | 'test' | 'build' | 'desktop_live', boolean>

const EVERYTHING: Flags = { full: true, test: true, build: true, desktop_live: true }

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function write(repo: string, file: string, content: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}

/** Builds a clone whose base commit holds `apps/sim/x.ts` and whose origin is a local bare repo. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ci-changes-'))
  fixtures.push(root)
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')
  git(root, 'init', '--quiet', '--bare', origin)
  git(root, 'init', '--quiet', repo)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'remote', 'add', 'origin', origin)
  write(repo, 'apps/sim/x.ts', 'export const x = 1\n'.repeat(20))
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'push', '--quiet', 'origin', 'HEAD:refs/heads/base')
  return { repo, base }
}

function classify(repo: string, base: string): Flags {
  const result = spawnSync('bash', [script, base], { cwd: repo, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  const lines = result.stdout.trim().split('\n')
  for (const line of lines) expect(line).toMatch(/^[a-z_]+=(true|false)$/)
  const flags = Object.fromEntries(lines.map((line) => line.split('=')))
  expect(lines).toHaveLength(4)
  expect(Object.keys(flags).sort()).toEqual(['build', 'desktop_live', 'full', 'test'])
  return {
    full: flags.full === 'true',
    test: flags.test === 'true',
    build: flags.build === 'true',
    desktop_live: flags.desktop_live === 'true',
  }
}

/** Commits `files` on top of the base, as a pull request changing exactly those paths. */
function classifyFiles(files: string[]): Flags {
  const { repo, base } = fixture()
  for (const file of files) write(repo, file, `${file}\n`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'change')
  return classify(repo, base)
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CI change classifier', () => {
  it.each<{ name: string; files: string[]; expected: Flags }>([
    {
      name: '#8931 library post and its cover',
      files: [
        'apps/sim/content/library/best-ai-agents-web-scraping-market-research/index.mdx',
        'apps/sim/public/library/best-ai-agents-web-scraping-market-research/cover.jpg',
      ],
      expected: { full: false, test: true, build: true, desktop_live: false },
    },
    {
      name: '#8927 changelog review note',
      files: ['apps/sim/content/changelog/nebius-models-for-agents/production.md'],
      expected: { full: false, test: true, build: true, desktop_live: false },
    },
    {
      name: '#8924 changelog post with a docs page and a screenshot',
      files: [
        'apps/docs/content/docs/workflows/blocks/agent.mdx',
        'apps/sim/content/changelog/editorial-standard.md',
        'apps/sim/content/changelog/nebius-models-for-agents/index.mdx',
        'apps/sim/content/changelog/nebius-models-for-agents/production.md',
        'apps/sim/public/changelog/nebius-model-picker-v1.jpg',
      ],
      expected: { full: false, test: true, build: true, desktop_live: false },
    },
    {
      name: 'an author profile',
      files: ['apps/sim/content/authors/waleed.json', 'apps/sim/public/authors/waleed.jpg'],
      expected: { full: false, test: true, build: true, desktop_live: false },
    },
    {
      name: '#8767 docs app',
      files: ['apps/docs/app/llms-full.txt/route.ts'],
      expected: { full: false, test: true, build: false, desktop_live: false },
    },
    {
      name: '#8855 desktop app',
      files: ['apps/desktop/e2e/local-files.spec.ts', 'apps/desktop/src/main/menu.ts'],
      expected: { full: false, test: true, build: false, desktop_live: true },
    },
    {
      name: 'agent guidance only (from #8887)',
      files: [
        '.agents/skills/add-block/SKILL.md',
        '.claude/rules/sim-testing.md',
        '.cursor/rules/sim-testing.mdc',
        'CLAUDE.md',
        'apps/sim/CLAUDE.md',
        'apps/sim/stores/AGENTS.md',
      ],
      expected: { full: false, test: false, build: false, desktop_live: false },
    },
    {
      name: '#8897 docs page with app code',
      files: [
        'apps/docs/content/docs/platform/enterprise/whitelabeling.mdx',
        'apps/sim/app/_shell/application-loading.tsx',
      ],
      expected: EVERYTHING,
    },
    {
      name: '#8806 library post with a lockfile',
      files: [
        'apps/sim/content/library/best-ai-agent-marketplaces-template-libraries/index.mdx',
        'apps/sim/public/library/best-ai-agent-marketplaces-template-libraries/cover.jpg',
        'bun.lock',
      ],
      expected: EVERYTHING,
    },
    {
      name: '#8937 CI script with app code',
      files: ['.github/scripts/http-e2e.sh', 'apps/sim/scripts/test-mobile-e2e.ts'],
      expected: EVERYTHING,
    },
    {
      name: 'a Markdown file under .github',
      files: ['.github/CONTRIBUTING.md'],
      expected: EVERYTHING,
    },
    {
      name: '#8772 PII service, outside the live desktop suite',
      files: ['apps/pii/server.py'],
      expected: { full: true, test: true, build: true, desktop_live: false },
    },
    {
      name: 'a component beside a blog post',
      files: ['apps/sim/content/blog/v0-5/components.tsx'],
      expected: { full: true, test: true, build: true, desktop_live: false },
    },
    {
      name: 'a public asset outside the content folders',
      files: ['apps/sim/public/landing/hero.png'],
      expected: EVERYTHING,
    },
    {
      name: 'a README that is a test fixture',
      files: ['apps/sim/tools/pitchbook/__fixtures__/README.md'],
      expected: { full: true, test: true, build: true, desktop_live: false },
    },
    {
      name: 'the desktop bridge package, which apps/sim imports',
      files: ['packages/desktop-bridge/src/index.ts'],
      expected: EVERYTHING,
    },
  ])('$name', ({ files, expected }) => {
    expect(classifyFiles(files)).toEqual(expected)
  })

  it('runs everything when a file moves from app code into an allowlisted path', () => {
    const { repo, base } = fixture()
    mkdirSync(join(repo, 'apps/docs'), { recursive: true })
    git(repo, 'mv', 'apps/sim/x.ts', 'apps/docs/x.ts')
    git(repo, 'commit', '--quiet', '-m', 'move')

    expect(classify(repo, base)).toEqual(EVERYTHING)
  })

  it('runs everything when the diff is empty', () => {
    const { repo, base } = fixture()
    git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'empty')

    expect(classify(repo, base)).toEqual(EVERYTHING)
  })

  it('runs everything when the base commit cannot be fetched', () => {
    const { repo } = fixture()
    expect(classify(repo, '0'.repeat(40))).toEqual(EVERYTHING)
  })

  it('runs everything when no base commit is given', () => {
    const { repo } = fixture()
    expect(classify(repo, '')).toEqual(EVERYTHING)
  })
})
