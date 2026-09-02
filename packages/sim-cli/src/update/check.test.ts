/**
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_VERSION } from '../version'
import { announceUpdateIfAvailable, resetUpdateCheck, upgradeCommand } from './check'

/** A global install, which is the only shape that gets advised at all. */
const INSTALLED = '/usr/local/lib/node_modules/sim/dist/index.js'

let configDir: string
let notices: string[]
let fetched: URL[]
let inits: RequestInit[]

/** Answers the dist-tags request the way the registry does. */
function stubRegistry(
  tags: Record<string, unknown> | 'reject' | 'not-found' | 'html' | 'oversized'
): void {
  vi.stubGlobal('fetch', (input: URL, init: RequestInit) => {
    fetched.push(input)
    inits.push(init)
    if (tags === 'oversized') {
      return Promise.resolve(
        Response.json({ latest: '2.1.5' }, { headers: { 'content-length': String(1024 * 1024) } })
      )
    }
    if (tags === 'reject') return Promise.reject(new Error('getaddrinfo ENOTFOUND'))
    if (tags === 'not-found') return Promise.resolve(new Response('', { status: 404 }))
    if (tags === 'html') return Promise.resolve(new Response('<html>nope</html>', { status: 200 }))
    return Promise.resolve(Response.json(tags))
  })
}

async function run(overrides: Parameters<typeof announceUpdateIfAvailable>[0] = {}) {
  await announceUpdateIfAvailable({
    currentVersion: '2.1.2',
    env: {},
    isTty: true,
    modulePath: INSTALLED,
    write: (message) => notices.push(message),
    ...overrides,
  })
}

function cachePath(): string {
  return join(configDir, 'update-check.json')
}

beforeEach(() => {
  resetUpdateCheck()
  configDir = mkdtempSync(join(tmpdir(), 'sim-cli-update-'))
  process.env.SIM_CONFIG_DIR = configDir
  notices = []
  fetched = []
  inits = []
  stubRegistry({ latest: '2.1.5' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  // `= undefined` would store the literal string "undefined", leaving later
  // tests pointed at a relative `./undefined` config directory.
  process.env.SIM_CONFIG_DIR = undefined
  rmSync(configDir, { recursive: true, force: true })
})

describe('announcing a newer release', () => {
  it('names both versions and the command that closes the gap', async () => {
    await run()
    expect(notices.join('')).toBe(
      'Update available: sim 2.1.2 → 2.1.5. Run: npm install -g sim@latest\n'
    )
  })

  it('asks the registry for the dist-tags and nothing else', async () => {
    await run()
    expect(fetched.map(String)).toEqual(['https://registry.npmjs.org/-/package/sim/dist-tags'])
  })

  it('stays silent when the installed version is current', async () => {
    await run({ currentVersion: '2.1.5' })
    expect(notices).toEqual([])
  })

  it('stays silent when the installed version is ahead of the tag', async () => {
    await run({ currentVersion: '2.2.0' })
    expect(notices).toEqual([])
  })

  it('writes through the real default: stderr yes, stdout never', async () => {
    // Deliberately without the `write` override, so the production default is
    // the thing under test. stdout may be a pipeline feeding jq.
    const realOut = process.stdout.write
    const realErr = process.stderr.write
    const seen = { out: [] as string[], err: [] as string[] }
    process.stdout.write = ((chunk: string) => {
      seen.out.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      seen.err.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await announceUpdateIfAvailable({
        currentVersion: '2.1.2',
        env: {},
        isTty: true,
        modulePath: INSTALLED,
      })
    } finally {
      process.stdout.write = realOut
      process.stderr.write = realErr
    }
    expect(seen.out).toEqual([])
    expect(seen.err.join('')).toContain('Update available: sim 2.1.2 → 2.1.5')
  })

  it('sends only its own version, and refuses to follow a redirect', async () => {
    await run()
    const headers = inits[0]?.headers as Record<string, string>
    // The reduced agent is the privacy property: the exported USER_AGENT in
    // version.ts also carries node version, platform and arch.
    expect(headers['user-agent']).toBe(`sim-cli/${CLI_VERSION}`)
    expect(headers.accept).toBe('application/json')
    expect(headers.authorization).toBeUndefined()
    expect(inits[0]?.redirect).toBe('error')
  })

  it('bounds the request so a hung registry cannot stall the command', async () => {
    await run()
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('when the notice is suppressed', () => {
  it('respects SIM_NO_UPDATE_CHECK', async () => {
    await run({ env: { SIM_NO_UPDATE_CHECK: '1' } })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it('treats an explicitly off value as not set', async () => {
    await run({ env: { SIM_NO_UPDATE_CHECK: '0' } })
    expect(notices).toHaveLength(1)
  })

  it('says nothing when stderr is not a terminal', async () => {
    await run({ isTty: false })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it.each(['CI', 'GITHUB_ACTIONS', 'JENKINS_URL', 'TEAMCITY_VERSION', 'BUILDKITE'])(
    'says nothing when %s is set, even where CI allocates a terminal',
    async (variable) => {
      await run({ env: { [variable]: 'true' } })
      expect(fetched).toEqual([])
      expect(notices).toEqual([])
    }
  )

  it.each([
    '/Users/x/.npm/_npx/a1b2/node_modules/sim/dist/index.js',
    'C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\a1b2\\node_modules\\sim\\dist\\index.js',
  ])('says nothing under npx, which resolves the tag on every run (%s)', async (modulePath) => {
    await run({ modulePath })
    expect(notices).toEqual([])
  })

  it.each([
    '/Users/x/sim/packages/sim-cli/dist/index.js',
    // Windows, and mixed case: a checkout is a checkout on a case-insensitive
    // volume too, and this is the guard that stops every Sim engineer being
    // nagged daily by their own build.
    'C:\\Users\\x\\Sim\\Packages\\Sim-CLI\\dist\\index.js',
  ])(
    'says nothing from a checkout, whose manifest trails npm by design (%s)',
    async (modulePath) => {
      await run({ modulePath })
      expect(notices).toEqual([])
    }
  )

  it('says nothing to a prerelease install', async () => {
    stubRegistry({ latest: '2.1.5', staging: '2.1.6-preview.812.1' })
    await run({ currentVersion: '2.1.3-preview.44.1' })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it('says nothing when the running version cannot be read', async () => {
    await run({ currentVersion: 'not-a-version' })
    expect(notices).toEqual([])
  })

  it('speaks only once per process', async () => {
    await run()
    rmSync(cachePath(), { force: true })
    await run()
    expect(notices).toHaveLength(1)
  })
})

describe('the once-a-day cache', () => {
  it('records the check, and what it found', async () => {
    const now = new Date('2026-09-02T10:00:00.000Z')
    await run({ now })
    expect(JSON.parse(readFileSync(cachePath(), 'utf8'))).toEqual({
      version: 1,
      checkedAt: '2026-09-02T10:00:00.000Z',
      latestVersion: '2.1.5',
    })
    // Assert the property, not the literal mode: writeFileSync's mode is
    // masked by the ambient umask, so an exact comparison fails under
    // `umask 077` for reasons that have nothing to do with this code.
    expect(statSync(cachePath()).mode & 0o022).toBe(0)
  })

  it('does not contact the registry again within the day', async () => {
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    resetUpdateCheck()
    fetched = []
    notices = []
    await run({ now: new Date('2026-09-02T22:00:00.000Z') })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it('checks again once the day is up', async () => {
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    resetUpdateCheck()
    notices = []
    await run({ now: new Date('2026-09-03T11:00:00.000Z') })
    expect(notices).toHaveLength(1)
  })

  it('checks again when the clock has moved backwards', async () => {
    // A stamp in the future would otherwise suppress the notice until the clock
    // caught up, which after a one-off jump forward is permanently.
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    resetUpdateCheck()
    notices = []
    await run({ now: new Date('2026-09-01T10:00:00.000Z') })
    expect(notices).toHaveLength(1)
  })

  it('re-checks rather than trusting a truncated file', async () => {
    writeFileSync(cachePath(), '{"version": 1, "checked')
    await run()
    expect(notices).toHaveLength(1)
  })

  it('re-checks rather than trusting a cache a newer CLI wrote', async () => {
    writeFileSync(cachePath(), JSON.stringify({ version: 99, checkedAt: new Date().toISOString() }))
    await run()
    expect(notices).toHaveLength(1)
  })

  it('still runs the command when the cache cannot be written', async () => {
    const wall = join(configDir, 'wall')
    writeFileSync(wall, 'not a directory')
    process.env.SIM_CONFIG_DIR = join(wall, 'sim')
    await expect(run()).resolves.toBeUndefined()
    expect(notices).toHaveLength(1)
  })
})

describe('when the registry does not answer', () => {
  it.each([
    ['the request fails', 'reject' as const],
    ['the response is an error', 'not-found' as const],
    ['a proxy answers with an HTML page', 'html' as const],
  ])('stays silent and does not throw when %s', async (_label, behaviour) => {
    stubRegistry(behaviour)
    await expect(run()).resolves.toBeUndefined()
    expect(notices).toEqual([])
  })

  it.each([
    ['an empty object', {} as Record<string, unknown>],
    ['a non-string tag value', { latest: 42 } as Record<string, unknown>],
    ['a nested object where a version belongs', { latest: { version: '9.9.9' } }],
  ])('stays silent when the payload carries %s', async (_label, payload) => {
    stubRegistry(payload)
    await run()
    expect(notices).toEqual([])
  })

  it('refuses a body far larger than this endpoint could legitimately return', async () => {
    stubRegistry('oversized')
    await run()
    expect(notices).toEqual([])
  })

  it('stays silent when the tag is missing or is not a version', async () => {
    stubRegistry({ staging: '2.1.6-preview.1.1' })
    await run()
    expect(notices).toEqual([])

    resetUpdateCheck()
    rmSync(cachePath(), { force: true })
    stubRegistry({ latest: 'nonsense' })
    await run()
    expect(notices).toEqual([])
  })

  it('still records the attempt, so a dead registry costs one request a day', async () => {
    stubRegistry('reject')
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    expect(JSON.parse(readFileSync(cachePath(), 'utf8')).latestVersion).toBeNull()
  })

  it('asks a configured mirror instead of the default', async () => {
    await run({ env: { npm_config_registry: 'https://npm.internal/api/npm' } })
    expect(fetched.map(String)).toEqual(['https://npm.internal/api/npm/-/package/sim/dist-tags'])
  })

  it.each([
    ['a value that is not a url', 'not a url'],
    ['a non-http protocol', 'file:///var/tmp/registry'],
    ['whitespace', '   '],
  ])('falls back to the default registry for %s', async (_label, configured) => {
    await run({ env: { npm_config_registry: configured } })
    expect(fetched.map(String)).toEqual(['https://registry.npmjs.org/-/package/sim/dist-tags'])
  })

  it("keeps a token-authenticated mirror's own path and query", async () => {
    // Artifactory and Nexus bases carry both. Resolving the path as a relative
    // URL would drop them and ask the mirror a question it answers with a 404.
    await run({ env: { npm_config_registry: 'https://npm.internal/api/npm/repo?token=abc' } })
    expect(fetched.map(String)).toEqual([
      'https://npm.internal/api/npm/repo/-/package/sim/dist-tags?token=abc',
    ])
  })
})

describe('the upgrade command', () => {
  it.each([
    ['/usr/local/lib/node_modules/sim/dist/index.js', 'npm install -g sim@latest'],
    ['/Users/x/.bun/install/global/node_modules/sim/dist/index.js', 'bun add -g sim@latest'],
    ['/Users/x/Library/pnpm/global/5/node_modules/sim/dist/index.js', 'pnpm add -g sim@latest'],
    ['/Users/x/.yarn/global/node_modules/sim/dist/index.js', 'yarn global add sim@latest'],
    [
      'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\sim\\dist\\index.js',
      'npm install -g sim@latest',
    ],
    [
      'C:\\Users\\x\\AppData\\Local\\pnpm\\global\\5\\node_modules\\sim\\dist\\index.js',
      'pnpm add -g sim@latest',
    ],
  ])('reads %s as the installation it is', (modulePath, expected) => {
    expect(upgradeCommand('latest', modulePath, {})).toBe(expected)
  })

  it('falls back to the invoking package manager when the path says nothing', () => {
    expect(
      upgradeCommand('latest', INSTALLED, { npm_config_user_agent: 'pnpm/9.1.0 npm/? node/v22' })
    ).toBe('pnpm add -g sim@latest')
  })

  it('names the channel it is advising, not always the stable one', () => {
    expect(upgradeCommand('staging', INSTALLED, {})).toBe('npm install -g sim@staging')
  })
})
