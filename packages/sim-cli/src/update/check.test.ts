import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliVersion } from '#sim-cli/version'
import { announceUpdateIfAvailable, type UpdateCheckOptions } from './check'

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
    expect(notices.join('')).toBe('Update available: sim 2.1.2 → 2.1.5. Run: sim update\n')
  })

  it('sends only its own version and gives the request a one-second deadline', async () => {
    await run()
    const headers = inits[0]?.headers
    expect(headers['user-agent']).toBe(`sim-cli/${cliVersion()}`)
    expect(headers.accept).toBe('application/json')
    expect(headers.authorization).toBeUndefined()
    expect(inits[0]?.maxResponseBytes).toBe(64 * 1024)
    expect(inits[0]?.timeoutMs).toBe(1000)
  })
})

describe('when the notice is suppressed', () => {
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
  ])('says nothing for an npx cache installation (%s)', async (modulePath) => {
    await run({ modulePath })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('the once-a-day cache', () => {
  it('re-checks rather than trusting a truncated file', async () => {
    writeFileSync(cachePath(), '{"version": 1, "checked')
    await run()
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
  it('refuses a body far larger than this endpoint could legitimately return', async () => {
    stubRegistry('oversized')
    await run()
    expect(notices).toEqual([])
  })

  it('refuses registry URLs with username/password userinfo', async () => {
    await run({ env: { npm_config_registry: 'https://user:secret@npm.internal/api/npm' } })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })
})
