import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sleep } from '../helpers'
import { configPath, credentialsPath } from './paths'
import {
  DEFAULT_ENDPOINT,
  resolveAuthenticationProfileName,
  resolveProfile,
  withCredentialsLock,
  withProfileLoginLease,
  writeConfigProfile,
  writeCredentialsProfile,
} from './profile'

let dir: string
const ENV_KEYS = ['SIM_PROFILE', 'SIM_ENDPOINT', 'SIM_API_KEY', 'SIM_WORKSPACE', 'SIM_OUTPUT']

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-cli-'))
  process.env.SIM_CONFIG_DIR = dir
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  process.env.SIM_CONFIG_DIR = undefined
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('profile resolution', () => {
  it('shares only authentication and endpoint through auth_profile', () => {
    writeConfigProfile('default', {
      endpoint: 'https://sim.example',
      workspace: 'ws_default',
      output: 'yaml',
    })
    writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'key_default' })
    writeConfigProfile('acme', {
      auth_profile: 'default',
      workspace: 'ws_acme',
      output: 'json',
    })

    expect(resolveAuthenticationProfileName('acme')).toBe('default')
    expect(resolveProfile({ profile: 'acme' })).toMatchObject({
      name: 'acme',
      endpoint: 'https://sim.example',
      workspaceId: 'ws_acme',
      output: 'json',
      apiKey: 'key_default',
      sources: {
        endpoint: 'config',
        workspaceId: 'config',
        output: 'config',
        credential: 'credentials',
      },
    })
  })

  it('fails fast on empty, missing, self-referential, or chained auth profiles', () => {
    // Written by hand, because the writer refuses a blank value: it reads back
    // as unset while the write reports success.
    writeFileSync(configPath(), '[profile empty]\nauth_profile =\n')
    expect(() => resolveProfile({ profile: 'empty' })).toThrow(
      'Profile "empty" has an empty auth_profile.'
    )

    writeConfigProfile('missing', { auth_profile: 'gone' })
    expect(() => resolveProfile({ profile: 'missing' })).toThrow(
      'Profile "missing" references missing auth_profile "gone".'
    )

    writeConfigProfile('self', { auth_profile: 'self' })
    expect(() => resolveProfile({ profile: 'self' })).toThrow(
      'Profile "self" cannot use itself as auth_profile.'
    )

    writeConfigProfile('base', { auth_profile: 'root' })
    writeCredentialsProfile('root', { kind: 'api_key', apiKey: 'key_root' })
    writeConfigProfile('chained', { auth_profile: 'base' })
    expect(() => resolveProfile({ profile: 'chained' })).toThrow(
      'Profile "chained" references auth_profile "base", which also has auth_profile set.'
    )
  })

  it('rejects ambiguous local authentication settings on a shared profile', () => {
    writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'key_default' })
    writeConfigProfile('endpoint-alias', {
      auth_profile: 'default',
      endpoint: 'https://other.example',
    })
    expect(() => resolveProfile({ profile: 'endpoint-alias' })).toThrow(
      'Profile "endpoint-alias" cannot set both auth_profile and endpoint.'
    )

    writeConfigProfile('key-alias', { auth_profile: 'default' })
    writeCredentialsProfile('key-alias', { kind: 'api_key', apiKey: 'key_alias' })
    expect(() => resolveProfile({ profile: 'key-alias' })).toThrow(
      'Profile "key-alias" cannot set both auth_profile and its own login. Remove one of them.'
    )
  })

  it('lets a flag beat the environment, and the environment beat the file', () => {
    writeConfigProfile('default', { endpoint: 'https://file.example' })

    expect(resolveProfile().endpoint).toBe('https://file.example')

    process.env.SIM_ENDPOINT = 'https://env.example'
    expect(resolveProfile()).toMatchObject({ endpoint: 'https://env.example' })
    expect(resolveProfile().sources.endpoint).toBe('env')

    expect(resolveProfile({ endpoint: 'https://flag.example' })).toMatchObject({
      endpoint: 'https://flag.example',
    })
    expect(resolveProfile({ endpoint: 'https://flag.example' }).sources.endpoint).toBe('flag')
  })

  it('refuses an unknown profile instead of silently resolving it to production', () => {
    // A typo used to fall through to the built-in defaults, so `--profile
    // stagng` talked to https://www.sim.ai and handed it whatever key resolved.
    writeConfigProfile('staging', { endpoint: 'https://staging.example' })
    writeCredentialsProfile('staging', { kind: 'api_key', apiKey: 'key_staging' })

    expect(() => resolveProfile({ profile: 'stagng' })).toThrow(
      'Unknown profile "stagng". Did you mean "staging"? Configured profiles: staging.'
    )

    process.env.SIM_PROFILE = 'ghost'
    expect(() => resolveProfile()).toThrow('Unknown profile "ghost". Configured profiles: staging.')
  })

  it('refuses an endpoint carrying a control character, from every source', () => {
    // The URL parser deletes tabs and line breaks from anywhere in its input
    // before parsing, so the host a reader sees in the string need not be the
    // host the request reaches — and the request carries the API key. Trimming
    // only reaches the ends, so the normalizer has to refuse the whole set.
    for (const endpoint of [
      'https://www.sim.ai\n@other.invalid',
      'https://www.sim.ai\r@other.invalid',
      'https://www.sim.ai\t@other.invalid',
      'https://www.sim.ai\u0000@other.invalid',
      'https://www.sim.ai\u2028@other.invalid',
    ]) {
      expect(() => resolveProfile({ endpoint })).toThrow(
        'An endpoint cannot contain line breaks or control characters.'
      )
      // The rejected text is echoed back with the control characters redacted,
      // so an error message cannot become an escape-sequence delivery vehicle.
      expect(() => resolveProfile({ endpoint })).toThrow(
        'Invalid endpoint "https://www.sim.ai @other.invalid" from flag.'
      )
    }

    process.env.SIM_ENDPOINT = 'https://www.sim.ai\t@other.invalid'
    expect(() => resolveProfile()).toThrow(
      'Invalid endpoint "https://www.sim.ai @other.invalid" from env.'
    )

    Reflect.deleteProperty(process.env, 'SIM_ENDPOINT')
    // A tab survives the config reader — `.` matches it, unlike a line break —
    // so a hand-edited file can hold one even though the writer refuses to
    // produce it, and the read path has to refuse it too.
    writeFileSync(configPath(), '[default]\nendpoint = https://www.sim.ai\t@other.invalid\n')
    expect(() => resolveProfile()).toThrow(
      'Invalid endpoint "https://www.sim.ai @other.invalid" from config.'
    )
  })

  it('fails fast on an endpoint Node cannot parse, naming the source', () => {
    expect(() => resolveProfile({ endpoint: 'not-a-url' })).toThrow(
      'Invalid endpoint "not-a-url" from flag. Use an absolute URL, e.g. https://www.sim.ai or http://localhost:3000'
    )

    process.env.SIM_ENDPOINT = 'not-a-url'
    expect(() => resolveProfile()).toThrow('Invalid endpoint "not-a-url" from env.')

    Reflect.deleteProperty(process.env, 'SIM_ENDPOINT')
    writeConfigProfile('default', { endpoint: 'not-a-url' })
    expect(() => resolveProfile()).toThrow('Invalid endpoint "not-a-url" from config.')
  })

  it('writes credentials 0600 even when the file already existed world-readable', () => {
    writeFileSync(credentialsPath(), '', { mode: 0o644 })
    writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'sim_key' })
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })
})

/**
 * Config values are serialized without escaping — the format has no escape
 * syntax — so text carrying a line break used to be read back as structure: an
 * extra setting, or a header for a different profile. Since `endpoint` is what
 * decides where the API key is sent, that made a stored name or value a way to
 * redirect the key.
 */
describe('config file injection', () => {
  const FORGED_SECTION = 'evil]\n[default]\nendpoint = http://elsewhere.invalid\n[x'
  const FORGED_SETTING = 'ws_1\nendpoint = http://elsewhere.invalid'

  it('refuses to create a profile whose name would forge a section', () => {
    expect(() => resolveProfile({ profile: FORGED_SECTION, allowUnknownProfile: true })).toThrow(
      /Invalid profile name/
    )
  })

  it('refuses to write a profile name that would forge a section', () => {
    expect(() => writeConfigProfile(FORGED_SECTION, { workspace: 'ws_evil' })).toThrow(
      /Refusing to write a section/
    )

    expect(existsSync(configPath())).toBe(false)
    expect(resolveProfile().endpoint).toBe(DEFAULT_ENDPOINT)
  })

  it('refuses to write a value that would forge a setting', () => {
    writeConfigProfile('default', { workspace: 'ws_ok' })

    expect(() => writeConfigProfile('default', { workspace: FORGED_SETTING })).toThrow(
      /Refusing to write a value/
    )

    expect(readFileSync(configPath(), 'utf8')).not.toContain('elsewhere.invalid')
    expect(resolveProfile()).toMatchObject({
      endpoint: DEFAULT_ENDPOINT,
      workspaceId: 'ws_ok',
    })
  })

  it('refuses the same through the credentials file', () => {
    // The credentials reader merges duplicate sections too, so a forged
    // `[victim]` block there would be read as a real key.
    expect(() =>
      writeCredentialsProfile(FORGED_SECTION, { kind: 'api_key', apiKey: 'key_evil' })
    ).toThrow(/Refusing to write a section/)
    expect(() =>
      writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'key\napi_key = other' })
    ).toThrow(/Refusing to write a value/)
    expect(existsSync(credentialsPath())).toBe(false)
  })
})

/**
 * A flag the user typed is not the same as one they left off, and `resolve`
 * cannot tell the two apart once a blank has reached it: it treats the empty
 * string as "not supplied", which is right for an environment variable and
 * wrong for `sim --workspace "" …`, which ran against the profile's stored
 * workspace instead of refusing.
 */
describe('blank root flags', () => {
  it('refuses a blank --workspace instead of falling back to the profile', () => {
    writeConfigProfile('default', { workspace: 'ws_stored' })

    expect(() => resolveProfile({ workspaceId: '' })).toThrow(/--workspace requires a value/)
    expect(() => resolveProfile({ workspaceId: '   ' })).toThrow(/--workspace requires a value/)
  })
})

/**
 * `configSectionName` builds a header by prefixing `profile `, so a second trim
 * on the way back out makes the listed name and the looked-up name disagree —
 * and the disagreement failed silently, resolving a selection that names a real
 * section to the built-in defaults.
 */
describe('a hand-written profile name carrying padding', () => {
  const PADDED = '[profile   padded   ]\nworkspace = ws_padded\nendpoint = https://padded.example\n'

  it('refuses the trimmed spelling loudly rather than resolving it to defaults', () => {
    writeFileSync(configPath(), PADDED)

    expect(() => resolveProfile({ profile: 'padded' })).toThrow(/Unknown profile "padded"/)
  })
})

describe('OAuth logins in the credentials file', () => {
  const OAUTH = {
    accessToken: 'sim_oat_a',
    refreshToken: 'sim_ort_r',
    expiresAt: 1_800_000_000_000,
    issuer: 'https://www.sim.ai/api/auth',
    loginId: 'login-1',
    scope: 'offline_access api:read api:write',
  }

  it('replaces a stored key when an OAuth login is written, and vice versa', () => {
    writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'sim_key' })
    writeCredentialsProfile('default', { kind: 'oauth', oauth: OAUTH })
    expect(readFileSync(credentialsPath(), 'utf8')).not.toContain('api_key')

    writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'sim_key_2' })
    const file = readFileSync(credentialsPath(), 'utf8')
    expect(file).not.toContain('access_token')
    expect(file).not.toContain('refresh_token')
    expect(resolveProfile().apiKey).toBe('sim_key_2')
  })

  it('lets an explicit SIM_API_KEY outrank the stored login', () => {
    writeCredentialsProfile('default', { kind: 'oauth', oauth: OAUTH })
    process.env.SIM_API_KEY = 'ci_key'

    const profile = resolveProfile()
    expect(profile.apiKey).toBe('ci_key')
    expect(profile.oauth).toBeNull()
    expect(profile.sources.credential).toBe('env')
  })

  it('serializes credential rewrites through the lock and releases it afterwards', async () => {
    const order: string[] = []
    await Promise.all([
      withCredentialsLock(async () => {
        order.push('a-start')
        await sleep(30)
        order.push('a-end')
      }),
      withCredentialsLock(async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
    expect(existsSync(`${credentialsPath()}.lock`)).toBe(false)
  })

  it('reclaims a lock left behind by a process that died holding it', async () => {
    const lockPath = `${credentialsPath()}.lock`
    mkdirSync(lockPath, { mode: 0o700 })
    /** Older than the 30-second stale window, so the holder is presumed gone. */
    const dead = new Date(Date.now() - 60_000)
    utimesSync(lockPath, dead, dead)

    await expect(withCredentialsLock(async () => 'ran')).resolves.toBe('ran')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('refuses a second interactive login lease for the same profile', async () => {
    let releaseFirst!: () => void
    const first = withProfileLoginLease(
      'default',
      () => new Promise<void>((resolve) => (releaseFirst = resolve))
    )
    await sleep(10)

    await expect(withProfileLoginLease('default', async () => undefined)).rejects.toThrow(
      'Another sim login is already in progress for profile "default".'
    )

    releaseFirst()
    await first
  })
})
