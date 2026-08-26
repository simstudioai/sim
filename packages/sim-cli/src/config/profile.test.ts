import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configPath, credentialsPath } from './paths'
import {
  DEFAULT_ENDPOINT,
  deleteProfile,
  FORBIDDEN_IN_VALUE,
  listAuthenticationDependents,
  listProfiles,
  OUTPUT_FORMATS,
  resolveAuthenticationProfileName,
  resolveProfile,
  validateProfileName,
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
  it('falls back to built-in defaults with nothing configured', () => {
    const profile = resolveProfile()
    expect(profile.name).toBe('default')
    expect(profile.endpoint).toBe('https://www.sim.ai')
    expect(profile.apiKey).toBeNull()
    expect(profile.output).toBe('table')
    expect(profile.sources.apiKey).toBe('unset')
  })

  it('reads settings and credentials for the default profile', () => {
    writeConfigProfile('default', { endpoint: 'https://a.example', workspace: 'ws_1' })
    writeCredentialsProfile('default', 'sim_key')

    const profile = resolveProfile()
    expect(profile.endpoint).toBe('https://a.example')
    expect(profile.workspaceId).toBe('ws_1')
    expect(profile.apiKey).toBe('sim_key')
    expect(profile.sources).toMatchObject({ endpoint: 'config', apiKey: 'credentials' })
  })

  it('namespaces a non-default profile as [profile x] in config but [x] in credentials', () => {
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'sim_dev')

    expect(readFileSync(configPath(), 'utf8')).toContain('[profile dev]')
    expect(readFileSync(credentialsPath(), 'utf8')).toContain('[dev]')
    expect(readFileSync(credentialsPath(), 'utf8')).not.toContain('[profile dev]')
  })

  it('keeps profiles isolated from one another', () => {
    writeConfigProfile('default', { endpoint: 'https://a.example', workspace: 'ws_a' })
    writeCredentialsProfile('default', 'key_a')
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000', workspace: 'ws_b' })
    writeCredentialsProfile('dev', 'key_b')

    expect(resolveProfile()).toMatchObject({ workspaceId: 'ws_a', apiKey: 'key_a' })
    expect(resolveProfile({ profile: 'dev' })).toMatchObject({
      workspaceId: 'ws_b',
      apiKey: 'key_b',
    })
  })

  it('keeps existing profiles self-authenticating when auth_profile is absent', () => {
    writeConfigProfile('dev', { endpoint: 'https://dev.example', workspace: 'ws_dev' })
    writeCredentialsProfile('dev', 'key_dev')

    expect(resolveAuthenticationProfileName('dev')).toBe('dev')
    expect(resolveProfile({ profile: 'dev' })).toMatchObject({
      endpoint: 'https://dev.example',
      workspaceId: 'ws_dev',
      apiKey: 'key_dev',
    })
  })

  it('shares only authentication and endpoint through auth_profile', () => {
    writeConfigProfile('default', {
      endpoint: 'https://sim.example',
      workspace: 'ws_default',
      output: 'yaml',
    })
    writeCredentialsProfile('default', 'key_default')
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
        apiKey: 'credentials',
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
    writeCredentialsProfile('root', 'key_root')
    writeConfigProfile('chained', { auth_profile: 'base' })
    expect(() => resolveProfile({ profile: 'chained' })).toThrow(
      'Profile "chained" references auth_profile "base", which also has auth_profile set.'
    )
  })

  it('rejects ambiguous local authentication settings on a shared profile', () => {
    writeCredentialsProfile('default', 'key_default')
    writeConfigProfile('endpoint-alias', {
      auth_profile: 'default',
      endpoint: 'https://other.example',
    })
    expect(() => resolveProfile({ profile: 'endpoint-alias' })).toThrow(
      'Profile "endpoint-alias" cannot set both auth_profile and endpoint.'
    )

    writeConfigProfile('key-alias', { auth_profile: 'default' })
    writeCredentialsProfile('key-alias', 'key_alias')
    expect(() => resolveProfile({ profile: 'key-alias' })).toThrow(
      'Profile "key-alias" cannot set both auth_profile and its own API key.'
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

  it('selects the profile from SIM_PROFILE when no flag is given', () => {
    writeCredentialsProfile('dev', 'key_dev')
    process.env.SIM_PROFILE = 'dev'
    expect(resolveProfile()).toMatchObject({ name: 'dev', apiKey: 'key_dev' })
    expect(resolveProfile({ profile: 'default' }).name).toBe('default')
  })

  it('refuses an unknown profile instead of silently resolving it to production', () => {
    // A typo used to fall through to the built-in defaults, so `--profile
    // stagng` talked to https://www.sim.ai and handed it whatever key resolved.
    writeConfigProfile('staging', { endpoint: 'https://staging.example' })
    writeCredentialsProfile('staging', 'key_staging')

    expect(() => resolveProfile({ profile: 'stagng' })).toThrow(
      'Unknown profile "stagng". Did you mean "staging"? Configured profiles: staging.'
    )

    process.env.SIM_PROFILE = 'ghost'
    expect(() => resolveProfile()).toThrow('Unknown profile "ghost". Configured profiles: staging.')
  })

  it('points a first-time typo at login rather than an empty profile list', () => {
    expect(() => resolveProfile({ profile: 'dev' })).toThrow(
      'Unknown profile "dev". No profiles are configured yet. Run: sim login --profile dev'
    )
  })

  it('keeps the default profile working with no config file at all', () => {
    // The documented CI path: set SIM_API_KEY and SIM_WORKSPACE, skip `sim
    // login`, and never touch the filesystem.
    process.env.SIM_API_KEY = 'ci_key'
    process.env.SIM_WORKSPACE = 'ws_ci'

    expect(resolveProfile()).toMatchObject({ name: 'default', apiKey: 'ci_key' })
    expect(resolveProfile({ profile: 'default' })).toMatchObject({ name: 'default' })

    process.env.SIM_PROFILE = 'default'
    expect(resolveProfile()).toMatchObject({ name: 'default', workspaceId: 'ws_ci' })
  })

  it('lets the commands that create a profile name one that does not exist yet', () => {
    expect(resolveProfile({ profile: 'brand-new', allowUnknownProfile: true })).toMatchObject({
      name: 'brand-new',
      endpoint: DEFAULT_ENDPOINT,
    })
  })

  it('accepts a profile that exists in only one of the two files', () => {
    writeCredentialsProfile('creds-only', 'key')
    writeConfigProfile('config-only', { workspace: 'ws_1' })

    expect(resolveProfile({ profile: 'creds-only' }).apiKey).toBe('key')
    expect(resolveProfile({ profile: 'config-only' }).workspaceId).toBe('ws_1')
  })

  it('defaults to the host that serves the API, not the apex that redirects to it', () => {
    // `sim.ai` answers /api/** with a 301 to `www.sim.ai`, and the client
    // refuses redirects because following one rewrites a POST into a bodyless
    // GET. Defaulting to the apex therefore broke every command for anyone who
    // never set an endpoint, so the host itself is the assertion.
    expect(DEFAULT_ENDPOINT).toBe('https://www.sim.ai')
    expect(new URL(DEFAULT_ENDPOINT).hostname).toBe('www.sim.ai')
    expect(resolveProfile().endpoint).toBe(DEFAULT_ENDPOINT)
  })

  it('strips a trailing slash so paths do not double up', () => {
    expect(resolveProfile({ endpoint: 'https://sim.ai///' }).endpoint).toBe('https://sim.ai')
  })

  it('trims a padded endpoint instead of storing text the writer would refuse', () => {
    // `new URL()` tolerates padding and hands the string straight back, but the
    // config writer refuses it. Untrimmed, `login --endpoint " https://…"` threw
    // only after the device flow had already minted and discarded a key.
    expect(resolveProfile({ endpoint: '  https://sim.ai/  ' }).endpoint).toBe('https://sim.ai')

    writeConfigProfile('default', { endpoint: 'https://sim.ai' })
    expect(() =>
      writeConfigProfile('default', {
        endpoint: resolveProfile({ endpoint: ' https://staging.sim.ai ' }).endpoint,
      })
    ).not.toThrow()
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

  it('rejects a parseable endpoint the HTTP client could never call', () => {
    expect(() => resolveProfile({ endpoint: 'ftp://x.com' })).toThrow(
      'Unsupported endpoint scheme "ftp" from flag. Use http or https, e.g. https://www.sim.ai'
    )
  })

  it('accepts every endpoint shape a self-hosted install needs', () => {
    for (const endpoint of [
      'http://localhost:3000',
      'https://10.0.0.7:8443',
      'https://sim.internal:8080/sim',
      'http://127.0.0.1:3000/',
    ]) {
      expect(resolveProfile({ endpoint }).endpoint).toBe(endpoint.replace(/\/+$/, ''))
    }
  })

  it('fails fast on an unrecognized active output format', () => {
    process.env.SIM_OUTPUT = 'xml'
    expect(() => resolveProfile()).toThrow(
      'Unknown output format "xml" from env. Use one of: table, json, yaml, text'
    )

    Reflect.deleteProperty(process.env, 'SIM_OUTPUT')
    writeConfigProfile('default', { output: 'xml' })
    expect(() => resolveProfile()).toThrow(
      'Unknown output format "xml" from config. Use one of: table, json, yaml, text'
    )
    expect(resolveProfile({ output: 'json' }).output).toBe('json')
  })

  it('resolves output from flag, environment, then profile', () => {
    writeConfigProfile('default', { output: 'yaml' })
    expect(resolveProfile()).toMatchObject({ output: 'yaml', sources: { output: 'config' } })

    process.env.SIM_OUTPUT = 'json'
    expect(resolveProfile()).toMatchObject({ output: 'json', sources: { output: 'env' } })

    expect(resolveProfile({ output: 'text' })).toMatchObject({
      output: 'text',
      sources: { output: 'flag' },
    })
  })

  it('accepts every documented output format from the environment', () => {
    for (const format of OUTPUT_FORMATS) {
      process.env.SIM_OUTPUT = format
      expect(resolveProfile().output).toBe(format)
    }
  })

  it('writes credentials 0600 even when the file already existed world-readable', () => {
    writeFileSync(credentialsPath(), '', { mode: 0o644 })
    writeCredentialsProfile('default', 'sim_key')
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })

  it('lists profiles from both files without duplicating', () => {
    writeConfigProfile('default', { endpoint: 'https://a.example' })
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'key')
    writeCredentialsProfile('ci', 'key')

    expect(listProfiles()).toEqual(['ci', 'default', 'dev'])
  })

  it('lists direct authentication dependents without treating a bad self-reference as one', () => {
    writeCredentialsProfile('default', 'key')
    writeConfigProfile('acme', { auth_profile: 'default', workspace: 'ws_acme' })
    writeConfigProfile('beta', { auth_profile: 'default', workspace: 'ws_beta' })
    writeConfigProfile('broken', { auth_profile: 'broken' })

    expect(listAuthenticationDependents('default')).toEqual(['acme', 'beta'])
    expect(listAuthenticationDependents('broken')).toEqual([])
  })

  it('deletes a profile from both files', () => {
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'key')

    expect(deleteProfile('dev')).toEqual({ config: true, credentials: true })
    expect(listProfiles()).toEqual([])
    expect(deleteProfile('dev')).toEqual({ config: false, credentials: false })
  })

  it('clears just the key when the credential is removed', () => {
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'key')
    writeCredentialsProfile('dev', null)

    expect(resolveProfile({ profile: 'dev' })).toMatchObject({
      apiKey: null,
      endpoint: 'http://localhost:3000',
    })
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

  it('redacts control characters out of the rejected name, like its sibling', () => {
    // The message lands in a terminal, so echoing the rejected name verbatim
    // would let it carry escape sequences there. `normalizeWorkspaceId` already
    // redacts through the same pattern.
    let message = ''
    try {
      validateProfileName('evil\u001b[2J\nname')
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('Invalid profile name "evil [2J name"')
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
  })

  it('still resolves an existing profile whose name predates the rule', () => {
    // The shape rule governs creation only: a hand-written section keeps
    // working, whatever it is called.
    writeFileSync(configPath(), '[profile my stack]\nworkspace = ws_hand\n')

    expect(resolveProfile({ profile: 'my stack' })).toMatchObject({ workspaceId: 'ws_hand' })
    expect(resolveProfile({ profile: 'my stack', allowUnknownProfile: true })).toMatchObject({
      workspaceId: 'ws_hand',
    })
    expect(() => validateProfileName('my stack')).toThrow(/Invalid profile name/)
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
    expect(() => writeCredentialsProfile(FORGED_SECTION, 'key_evil')).toThrow(
      /Refusing to write a section/
    )
    expect(() => writeCredentialsProfile('default', 'key\napi_key = other')).toThrow(
      /Refusing to write a value/
    )
    expect(existsSync(credentialsPath())).toBe(false)
  })

  it('leaves an ordinary profile name and value writable', () => {
    writeConfigProfile('staging-1.eu', { endpoint: 'https://staging.example' })
    writeCredentialsProfile('staging-1.eu', 'sim_key')

    expect(resolveProfile({ profile: 'staging-1.eu' })).toMatchObject({
      endpoint: 'https://staging.example',
      apiKey: 'sim_key',
    })
  })

  it('does not conjure a profile out of an unset', () => {
    // An empty section is not inert: `listProfiles` counts section names, so it
    // made the unknown-profile guard accept the name from then on.
    writeConfigProfile('phantom', { workspace: null })

    expect(listProfiles()).not.toContain('phantom')
    expect(() => resolveProfile({ profile: 'phantom' })).toThrow(/Unknown profile/)
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

  it('refuses a blank --endpoint and a blank --profile the same way', () => {
    writeConfigProfile('default', { endpoint: 'https://stored.example' })

    expect(() => resolveProfile({ endpoint: '' })).toThrow(/--endpoint requires a value/)
    expect(() => resolveProfile({ profile: '' })).toThrow(/--profile requires a value/)
  })

  it('still reads an exported-but-empty environment variable as unset', () => {
    // The convention every profile-based CLI follows, and the reason the empty
    // string cannot simply become significant everywhere.
    writeConfigProfile('default', { workspace: 'ws_stored' })
    process.env.SIM_WORKSPACE = ''

    expect(resolveProfile()).toMatchObject({ workspaceId: 'ws_stored' })
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

  it('lists the name that actually selects it', () => {
    writeFileSync(configPath(), PADDED)

    expect(listProfiles()).toEqual(['  padded'])
    expect(resolveProfile({ profile: '  padded' })).toMatchObject({
      workspaceId: 'ws_padded',
      endpoint: 'https://padded.example',
    })
  })

  it('refuses the trimmed spelling loudly rather than resolving it to defaults', () => {
    writeFileSync(configPath(), PADDED)

    expect(() => resolveProfile({ profile: 'padded' })).toThrow(/Unknown profile "padded"/)
  })
})

/**
 * Every message that quotes text the CLI did not produce goes through the same
 * redaction. These three did not, so a bare newline reached the terminal and
 * appended lines that read as the CLI's own output.
 */
describe('redaction of rejected values', () => {
  const messageOf = (run: () => unknown): string => {
    try {
      run()
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('expected a refusal')
  }

  it('redacts the name in the unknown-profile refusal', () => {
    writeConfigProfile('dev', { workspace: 'ws_1' })

    const message = messageOf(() => resolveProfile({ profile: 'ev\nil' }))
    expect(message).toContain('Unknown profile "ev il"')
    expect(message).not.toMatch(FORBIDDEN_IN_VALUE)
  })

  it('redacts it in the variant printed when nothing is configured yet', () => {
    const message = messageOf(() => resolveProfile({ profile: 'ev\nil' }))
    expect(message).toContain('Unknown profile "ev il"')
    expect(message).not.toMatch(FORBIDDEN_IN_VALUE)
  })

  it('redacts the format in the unknown-output-format refusal', () => {
    process.env.SIM_OUTPUT = 'ev\nil'

    const message = messageOf(() => resolveProfile())
    expect(message).toContain('Unknown output format "ev il"')
    expect(message).not.toMatch(FORBIDDEN_IN_VALUE)
  })
})
