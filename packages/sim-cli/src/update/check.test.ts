/**
 * @vitest-environment node
 */
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLI_VERSION } from '../version'
import { announceUpdateIfAvailable, type UpdateCheckOptions, upgradeCommand } from './check'

/** A global install, which is the only shape that gets advised at all. */
const INSTALLED = '/usr/local/lib/node_modules/sim/dist/index.js'

let configDir: string
let previousConfigDir: string | undefined
let notices: string[]
let fetched: URL[]
type RegistryRequest = NonNullable<UpdateCheckOptions['registryRequest']>
let inits: Parameters<RegistryRequest>[1][]
let registryRequest: RegistryRequest

/** Answers the dist-tags request the way the registry does. */
function stubRegistry(
  tags: Record<string, unknown> | 'reject' | 'not-found' | 'html' | 'oversized'
): void {
  registryRequest = async (input, init) => {
    fetched.push(input)
    inits.push(init)
    if (tags === 'oversized') {
      return `${JSON.stringify({ latest: '2.1.5' })}${' '.repeat(64 * 1024)}`
    }
    if (tags === 'reject') throw new Error('getaddrinfo ENOTFOUND')
    if (tags === 'not-found') return null
    if (tags === 'html') return '<html>nope</html>'
    return JSON.stringify(tags)
  }
}

async function run(overrides: Parameters<typeof announceUpdateIfAvailable>[0] = {}) {
  await announceUpdateIfAvailable({
    currentVersion: '2.1.2',
    env: {},
    isTty: true,
    modulePath: INSTALLED,
    registryRequest,
    write: (message) => notices.push(message),
    ...overrides,
  })
}

function cachePath(): string {
  return join(configDir, 'update-check.json')
}

beforeEach(() => {
  previousConfigDir = process.env.SIM_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'sim-cli-update-'))
  process.env.SIM_CONFIG_DIR = configDir
  notices = []
  fetched = []
  inits = []
  stubRegistry({ latest: '2.1.5' })
})

afterEach(() => {
  if (previousConfigDir === undefined) Reflect.deleteProperty(process.env, 'SIM_CONFIG_DIR')
  else process.env.SIM_CONFIG_DIR = previousConfigDir
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

  it.each([
    ['minor', '2.2.0'],
    ['major', '3.0.0'],
  ])('announces a newer %s version', async (_difference, latest) => {
    stubRegistry({ latest })
    await run()
    expect(notices.join('')).toContain(`2.1.2 → ${latest}`)
  })

  it('writes through the real default: stderr yes, stdout never', async () => {
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
        registryRequest,
      })
    } finally {
      process.stdout.write = realOut
      process.stderr.write = realErr
    }
    expect(seen.out).toEqual([])
    expect(seen.err.join('')).toContain('Update available: sim 2.1.2 → 2.1.5')
  })

  it('sends only its own version and gives the request a one-second deadline', async () => {
    await run()
    const headers = inits[0]?.headers
    expect(headers['user-agent']).toBe(`sim-cli/${CLI_VERSION}`)
    expect(headers.accept).toBe('application/json')
    expect(headers.authorization).toBeUndefined()
    expect(inits[0]?.maxResponseBytes).toBe(64 * 1024)
    expect(inits[0]?.timeoutMs).toBe(1000)
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
    'C:\\Users\\x\\Sim\\Packages\\Sim-CLI\\dist\\index.js',
  ])(
    'says nothing from a checkout, whose manifest trails npm by design (%s)',
    async (modulePath) => {
      await run({ modulePath })
      expect(notices).toEqual([])
    }
  )

  it('says nothing to a prerelease install', async () => {
    stubRegistry({ latest: '2.1.5' })
    await run({ currentVersion: '2.1.3-preview.44.1' })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it('ignores stable build metadata when comparing versions', async () => {
    await run({ currentVersion: '2.1.2+local.1' })
    expect(notices).toHaveLength(1)
  })

  it('says nothing when the running version cannot be read', async () => {
    await run({ currentVersion: 'not-a-version' })
    expect(notices).toEqual([])
  })
})

describe('the once-a-day cache', () => {
  it('records when the check ran', async () => {
    const now = new Date('2026-09-02T10:00:00.000Z')
    await run({ now })
    expect(JSON.parse(readFileSync(cachePath(), 'utf8'))).toEqual({
      version: 1,
      checkedAt: '2026-09-02T10:00:00.000Z',
    })
    expect(statSync(cachePath()).mode & 0o022).toBe(0)
  })

  it('does not contact the registry again within the day', async () => {
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    fetched = []
    notices = []
    await run({ now: new Date('2026-09-02T22:00:00.000Z') })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it('checks again once the day is up', async () => {
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    notices = []
    await run({ now: new Date('2026-09-03T11:00:00.000Z') })
    expect(notices).toHaveLength(1)
  })

  it('checks again when the clock has moved backwards', async () => {
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
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

  it('re-checks rather than trusting an oversized valid fresh cache', async () => {
    const now = new Date('2026-09-02T10:00:00.000Z')
    writeFileSync(
      cachePath(),
      JSON.stringify({
        version: 1,
        checkedAt: now.toISOString(),
        padding: 'x'.repeat(1024 * 1024),
      })
    )

    await run({ now })

    expect(fetched).toHaveLength(1)
    expect(notices).toHaveLength(1)
  })

  it('replaces a hard-linked cache without modifying its other name', async () => {
    const victimPath = join(configDir, 'victim')
    writeFileSync(victimPath, 'do not overwrite')
    linkSync(victimPath, cachePath())

    await run()

    expect(readFileSync(victimPath, 'utf8')).toBe('do not overwrite')
    expect(JSON.parse(readFileSync(cachePath(), 'utf8'))).toMatchObject({
      version: 1,
      checkedAt: expect.any(String),
    })
  })

  it('re-checks rather than following a cache symlink', async () => {
    const victimPath = join(configDir, 'victim')
    writeFileSync(victimPath, JSON.stringify({ version: 1, checkedAt: new Date().toISOString() }))
    symlinkSync(victimPath, cachePath())

    await run()

    expect(fetched).toHaveLength(1)
    expect(notices).toHaveLength(1)
    expect(readFileSync(victimPath, 'utf8')).toContain('"version":1')
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

    rmSync(cachePath(), { force: true })
    stubRegistry({ latest: 'nonsense' })
    await run()
    expect(notices).toEqual([])
  })

  it('still records the attempt, so a dead registry costs one request a day', async () => {
    stubRegistry('reject')
    await run({ now: new Date('2026-09-02T10:00:00.000Z') })
    expect(JSON.parse(readFileSync(cachePath(), 'utf8'))).toEqual({
      version: 1,
      checkedAt: '2026-09-02T10:00:00.000Z',
    })
  })

  it('asks a configured mirror instead of the default', async () => {
    await run({ env: { npm_config_registry: 'https://npm.internal/api/npm' } })
    expect(fetched.map(String)).toEqual(['https://npm.internal/api/npm/-/package/sim/dist-tags'])
  })

  it('refuses registry URLs with username/password userinfo', async () => {
    await run({ env: { npm_config_registry: 'https://user:secret@npm.internal/api/npm' } })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it.each([
    ['a value that is not a URL', 'not a url'],
    ['a non-HTTP protocol', 'file:///var/tmp/registry'],
  ])('makes no request for %s', async (_label, configured) => {
    await run({ env: { npm_config_registry: configured } })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })

  it('uses the default registry when the configured value is only whitespace', async () => {
    await run({ env: { npm_config_registry: '   ' } })
    expect(fetched.map(String)).toEqual(['https://registry.npmjs.org/-/package/sim/dist-tags'])
  })

  it("keeps a token-authenticated mirror's own path and query", async () => {
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
    expect(upgradeCommand(modulePath, {})).toBe(expected)
  })

  it('falls back to the invoking package manager when the path says nothing', () => {
    expect(upgradeCommand(INSTALLED, { npm_config_user_agent: 'pnpm/9.1.0 npm/? node/v22' })).toBe(
      'pnpm add -g sim@latest'
    )
  })
})
