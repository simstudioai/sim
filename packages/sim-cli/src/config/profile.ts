import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { lock } from 'proper-lockfile'
import {
  FORBIDDEN_IN_VALUE,
  getSection,
  type IniDocument,
  listSections,
  ProfileConfigError,
  parseIni,
  removeSection,
  serializeIni,
  setSectionValues,
} from './ini'
import { configPath, credentialsPath } from './paths'

export const DEFAULT_PROFILE = 'default'

/**
 * The API host, which is the `www` one and not the apex.
 *
 * `sim.ai` answers `/api/**` with a 301 to `www.sim.ai`, and the CLI refuses to
 * follow a redirect — a 301 rewrites a POST into a bodyless GET, so following
 * one turns a write into a silent no-op and hands the API key to whatever host
 * `Location` names. Defaulting to the apex therefore made every command fail
 * for anyone who never set an endpoint, and before the refusal existed it was
 * worse: reads succeeded while writes quietly did nothing.
 */
export const DEFAULT_ENDPOINT = 'https://www.sim.ai'

/**
 * Output formats, in the order `--help` lists them.
 *
 * `table` is for reading, `json`/`yaml` for piping into a parser, and `text` is
 * the one for shell loops: tab-separated, no header, no colour, so `cut`/`awk`/
 * `while read` work without a JSON tool on the box.
 */
export const OUTPUT_FORMATS = ['table', 'json', 'yaml', 'text'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export { FORBIDDEN_IN_VALUE, ProfileConfigError } from './ini'

/** {@link FORBIDDEN_IN_VALUE}, for redacting every match out of an error message. */
const FORBIDDEN_IN_VALUE_GLOBAL = new RegExp(FORBIDDEN_IN_VALUE.source, 'g')

/**
 * Makes a rejected value safe to quote inside an error message.
 *
 * A message is one terminal line, so a value carrying a line break appends
 * lines that read as the CLI's own output. Every message that interpolates text
 * the CLI did not produce — a flag, an environment variable, a hand-edited
 * setting — goes through this, so the rule does not have to be rediscovered at
 * each new message.
 */
export function redact(value: string): string {
  return value.replace(FORBIDDEN_IN_VALUE_GLOBAL, ' ')
}

/**
 * A root flag typed with a value the CLI cannot use.
 *
 * Separate from the rest of {@link ProfileConfigError} so a caller that
 * deliberately tolerates an unresolvable profile — `profiles` shows a broken
 * one as a marked row rather than aborting, because that is the command you run
 * *because* a profile is broken — can still refuse the caller's own argument.
 * The class is the discriminator on purpose: matching the message text would
 * stop working the first time the wording changes.
 */
export class ProfileOverrideError extends ProfileConfigError {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileOverrideError'
  }
}

/**
 * The shape a newly created profile name has to have.
 *
 * Enforced only when a profile is being created. A name reaches the config file
 * as part of a section header, and the file format has no escape syntax, so a
 * name that carries a bracket or a line break would forge a header for another
 * profile — the writer refuses that outright, and this pattern is the friendlier
 * refusal that names the rule instead of the mechanism.
 */
export const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Refuses a name for a profile that does not exist yet.
 *
 * Creation only, deliberately: a hand-written `[profile my stack]` predates this
 * rule and must keep resolving, so the read path stays governed by
 * {@link requireKnownProfile} alone.
 */
export function validateProfileName(name: string): void {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    // Redacted the same way as in `normalizeWorkspaceId`: the rejected name is
    // untrusted text, and echoing its control characters into a terminal is how
    // an error message becomes an escape-sequence delivery vehicle.
    throw new ProfileConfigError(
      `Invalid profile name "${redact(name)}". Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number.`
    )
  }
}

/**
 * An OAuth login stored in the credentials file: the short-lived access token
 * the API reads, the rotating refresh token that renews it, and when the
 * access token lapses (epoch milliseconds).
 */
export interface StoredOAuthCredential {
  accessToken: string
  refreshToken: string
  expiresAt: number
  /** Authorization server that minted the credential. */
  issuer: string
  /** Stable across refresh rotation and replaced by a fresh login. */
  loginId: string
  /** Scope last returned by the authorization server. */
  scope: string
}

/** What a credentials section holds for a profile, or `null` when it is logged out. */
export type StoredCredential =
  | { kind: 'api_key'; apiKey: string }
  | { kind: 'oauth'; oauth: StoredOAuthCredential }

/** Everything a command needs to make a call, after the resolution chain runs. */
export interface ResolvedProfile {
  name: string
  endpoint: string
  /** The profile whose credentials section authenticates this one (itself, or its `auth_profile`). */
  authProfile: string
  /**
   * An API key, from a flag, the environment, or the credentials file. Null
   * when the profile authenticates through {@link oauth} instead — the two are
   * exclusive: a stored OAuth login wins over a stored key, and an explicit
   * `--api-key`/`SIM_API_KEY` wins over both.
   */
  apiKey: string | null
  oauth: StoredOAuthCredential | null
  workspaceId: string | null
  output: OutputFormat
  /** Where each value came from, for `sim whoami` to explain surprising results. */
  sources: {
    endpoint: SettingSource
    /** Where the profile's credential came from, whichever kind it is. */
    credential: SettingSource
    workspaceId: SettingSource
    output: SettingSource
  }
}

export type SettingSource = 'flag' | 'env' | 'config' | 'credentials' | 'default' | 'unset'

export interface ProfileOverrides {
  profile?: string
  endpoint?: string
  apiKey?: string
  workspaceId?: string
  output?: OutputFormat
  /**
   * Skips the "does this profile exist?" check for the two commands that
   * legitimately name a profile before it exists — `sim login --profile x` and
   * `sim configure --profile x --set-…`, both of which create it.
   */
  allowUnknownProfile?: boolean
}

/**
 * AWS's asymmetry, reproduced deliberately: the config file namespaces
 * non-default profiles as `[profile dev]` while the credentials file uses a bare
 * `[dev]`. It is a wart, but matching it means muscle memory and existing
 * tooling carry over.
 */
function configSectionName(profile: string): string {
  return profile === DEFAULT_PROFILE ? DEFAULT_PROFILE : `profile ${profile}`
}

function readIni(path: string): IniDocument {
  if (!existsSync(path)) return { preamble: [], sections: [] }
  return parseIni(readFileSync(path, 'utf8'))
}

function writeIni(path: string, doc: IniDocument, secret: boolean): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  /**
   * Written to a fresh file and renamed into place, so readers never observe a
   * partial profile. Credentials are additionally forced to 0600 before the
   * rename, including when a hand-created temporary path had wider permissions.
   */
  const temporary = `${path}.${process.pid}.${temporaryFileSequence++}.tmp`
  try {
    writeFileSync(temporary, serializeIni(doc), { mode: secret ? 0o600 : 0o644 })
    if (secret) chmodSync(temporary, 0o600)
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

let temporaryFileSequence = 0

export function readConfigProfile(profile: string): Record<string, string> {
  return getSection(readIni(configPath()), configSectionName(profile)) ?? {}
}

export function readCredentialsProfile(profile: string): Record<string, string> {
  return getSection(readIni(credentialsPath()), profile) ?? {}
}

/**
 * Resolves the one stored identity a profile authenticates through.
 *
 * Existing profiles authenticate through their same-named credentials section.
 * A workspace alias may instead name one direct `auth_profile`; references are
 * deliberately non-recursive so a hand-edited cycle or missing target fails
 * with the setting that needs repair rather than surfacing later as "no key".
 */
export function resolveAuthenticationProfileName(profile: string): string {
  const config = readConfigProfile(profile)
  if (!Object.hasOwn(config, 'auth_profile')) return profile

  const authProfile = config.auth_profile.trim()
  if (!authProfile) {
    throw new ProfileConfigError(`Profile "${redact(profile)}" has an empty auth_profile.`)
  }
  if (authProfile === profile) {
    throw new ProfileConfigError(
      `Profile "${redact(profile)}" cannot use itself as auth_profile. Remove the auth_profile setting instead.`
    )
  }
  if (Object.hasOwn(config, 'endpoint')) {
    throw new ProfileConfigError(
      `Profile "${redact(profile)}" cannot set both auth_profile and endpoint. Set the endpoint on authentication profile "${redact(authProfile)}".`
    )
  }
  if (readStoredCredential(profile)) {
    throw new ProfileConfigError(
      `Profile "${redact(profile)}" cannot set both auth_profile and its own login. Remove one of them.`
    )
  }

  const authConfig = readConfigProfile(authProfile)
  const credentials = readCredentialsProfile(authProfile)
  if (Object.keys(authConfig).length === 0 && Object.keys(credentials).length === 0) {
    throw new ProfileConfigError(
      `Profile "${redact(profile)}" references missing auth_profile "${redact(authProfile)}".`
    )
  }
  if (Object.hasOwn(authConfig, 'auth_profile')) {
    throw new ProfileConfigError(
      `Profile "${redact(profile)}" references auth_profile "${redact(authProfile)}", which also has auth_profile set. Authentication profile references cannot be chained.`
    )
  }

  return authProfile
}

/**
 * Every profile named by either file, deduplicated and sorted.
 *
 * The name is taken verbatim from what follows `profile `, without a second
 * trim. `configSectionName` builds the header back by prefixing `profile `, so
 * trimming here made the two disagree for a hand-written `[profile   padded]`:
 * it listed and passed the "does this profile exist?" check as `padded`, while
 * every read looked for `profile padded` and found nothing — so `-P padded`
 * silently resolved to the built-in defaults, and the spelling that does name
 * the section was refused as unknown. Reporting the padded name keeps the one
 * that selects it the one that is shown, which is also how the credentials
 * file's sections have always been listed.
 */
export function listProfiles(): string[] {
  const names = new Set<string>()

  for (const section of listSections(readIni(configPath()))) {
    if (section === DEFAULT_PROFILE) names.add(DEFAULT_PROFILE)
    else if (section.startsWith('profile ')) names.add(section.slice('profile '.length))
  }
  for (const section of listSections(readIni(credentialsPath()))) {
    names.add(section)
  }

  return [...names].sort()
}

/** Levenshtein distance. The inputs are profile names, so the matrix is tiny. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }

  return previous[b.length]
}

/** The closest configured profile, when it is within two edits of the typo. */
function nearestProfile(name: string, known: string[]): string | null {
  const lowered = name.toLowerCase()
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of known) {
    const distance = editDistance(lowered, candidate.toLowerCase())
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }

  return bestDistance <= 2 ? best : null
}

/**
 * Refuses a profile name that names nothing.
 *
 * Without this, a typo resolved to the built-in defaults — meaning
 * `sim --profile stagng …` silently talked to production and sent it whatever
 * key `SIM_API_KEY` or the `default` credentials held. Only an explicitly named
 * profile is checked: `default` stays valid with no config file at all, which
 * is the documented CI path of setting `SIM_API_KEY`/`SIM_WORKSPACE` and never
 * running `sim login`.
 */
function requireKnownProfile(name: string): void {
  if (name === DEFAULT_PROFILE) return

  const known = listProfiles()
  if (known.includes(name)) return

  if (known.length === 0) {
    throw new ProfileConfigError(
      `Unknown profile "${redact(name)}". No profiles are configured yet. Run: sim login --profile ${redact(name)}`
    )
  }

  const suggestion = nearestProfile(name, known)
  throw new ProfileConfigError(
    `Unknown profile "${redact(name)}".${suggestion ? ` Did you mean "${redact(suggestion)}"?` : ''} Configured profiles: ${known.map(redact).join(', ')}.`
  )
}

/** Profiles that directly share the named profile's stored authentication. */
export function listAuthenticationDependents(authProfile: string): string[] {
  return listProfiles().filter(
    (profile) =>
      profile !== authProfile && readConfigProfile(profile).auth_profile?.trim() === authProfile
  )
}

export function writeConfigProfile(profile: string, values: Record<string, string | null>): void {
  const doc = readIni(configPath())
  setSectionValues(doc, configSectionName(profile), values)
  writeIni(configPath(), doc, false)
}

/** The credentials-file keys one login occupies; a write of either kind clears the other. */
const CREDENTIAL_KEYS = [
  'api_key',
  'access_token',
  'refresh_token',
  'token_expires_at',
  'oauth_issuer',
  'oauth_login_id',
  'oauth_scope',
] as const

/**
 * Stores a login, replacing whatever the section held, or clears it with
 * `null`. One profile holds one credential: writing an OAuth login removes a
 * stored key and vice versa, so a profile can never resolve to a stale one.
 */
export function writeCredentialsProfile(
  profile: string,
  credential: StoredCredential | null
): void {
  const doc = readIni(credentialsPath())
  const values: Record<string, string | null> = Object.fromEntries(
    CREDENTIAL_KEYS.map((key) => [key, null])
  )
  if (credential?.kind === 'api_key') {
    values.api_key = credential.apiKey
  } else if (credential?.kind === 'oauth') {
    values.access_token = credential.oauth.accessToken
    values.refresh_token = credential.oauth.refreshToken
    values.token_expires_at = String(credential.oauth.expiresAt)
    values.oauth_issuer = credential.oauth.issuer
    values.oauth_login_id = credential.oauth.loginId
    values.oauth_scope = credential.oauth.scope
  }
  setSectionValues(doc, profile, values)
  writeIni(credentialsPath(), doc, true)
}

/**
 * The OAuth login a credentials section holds, or `null` when it holds none or
 * only part of one. A hand-edited section missing its refresh token is treated
 * as logged out rather than as a login that will fail on its first refresh.
 */
export function readStoredOAuth(credentials: Record<string, string>): StoredOAuthCredential | null {
  const {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: expires,
    oauth_issuer: issuer,
    oauth_login_id: loginId,
    oauth_scope: scope,
  } = credentials
  if (!accessToken || !refreshToken || !issuer || !loginId || !scope) return null
  const expiresAt = Number(expires)
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    issuer,
    loginId,
    scope,
  }
}

/** The Better Auth issuer mounted below a resolved Sim endpoint. */
export function oauthIssuerForEndpoint(endpoint: string): string {
  return new URL(`${endpoint}/api/auth`).toString().replace(/\/$/, '')
}

/** What the named profile's own credentials section holds. */
export function readStoredCredential(profile: string): StoredCredential | null {
  const credentials = readCredentialsProfile(profile)
  const oauth = readStoredOAuth(credentials)
  if (oauth) return { kind: 'oauth', oauth }
  if (credentials.api_key) return { kind: 'api_key', apiKey: credentials.api_key }
  return null
}

const CREDENTIALS_LOCK_STALE_MS = 30_000
/**
 * Long enough to outlast the slowest legitimate hold.
 *
 * The holder is refreshing tokens, which is bounded by the refresh request's
 * own 10s timeout plus the write. Waiting less than that made an ordinary slow
 * token endpoint — a cold start, a deploy cutover — fail every *other* `sim`
 * process outright while the first one was still doing exactly what it should.
 * It stays under {@link CREDENTIALS_LOCK_STALE_MS} so a genuinely dead holder
 * is still reclaimed rather than waited out.
 */
const CREDENTIALS_LOCK_WAIT_MS = 20_000
const CREDENTIALS_LOCK_POLL_MS = 50

/**
 * Serializes credential rewrites across `sim` processes.
 *
 * A refresh token is single-use: the server rotates it and treats a second
 * presentation as theft, revoking every token the CLI holds. Two commands run
 * in parallel — a shell loop, a CI matrix, an editor plugin — would each see
 * the same expiring token and both try to refresh it, and the loser logs the
 * user out everywhere. `proper-lockfile` uses an atomic lock directory and a
 * heartbeat, so exactly one process refreshes, the rest re-read what it wrote,
 * and an abandoned lock is reclaimed without a hand-rolled compare/delete
 * race.
 */
/**
 * Whether the current async context already holds the lock.
 *
 * Re-entrancy has to follow the *call chain*, not the process: a nested write
 * inside a refresh must not deadlock on a lock its own caller is holding, while
 * two unrelated `withCredentialsLock` calls running concurrently in the same
 * process must still serialize. A module-level flag cannot tell those apart —
 * `AsyncLocalStorage` can, because only work started inside the holder sees the
 * store.
 */
const heldLock = new AsyncLocalStorage<true>()

/** Prevents two interactive sign-ins from minting credentials for one profile concurrently. */
export async function withProfileLoginLease<T>(
  profile: string,
  work: () => Promise<T>
): Promise<T> {
  const digest = createHash('sha256').update(profile, 'utf8').digest('hex')
  const path = `${credentialsPath()}.login-${digest}`
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })

  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(path, {
      realpath: false,
      stale: CREDENTIALS_LOCK_STALE_MS,
      update: CREDENTIALS_LOCK_STALE_MS / 3,
      retries: 0,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new ProfileConfigError(
        `Another sim login is already in progress for profile "${redact(profile)}".`
      )
    }
    throw error
  }

  try {
    return await work()
  } finally {
    await release()
  }
}

export async function withCredentialsLock<T>(work: () => Promise<T>): Promise<T> {
  if (heldLock.getStore()) return work()

  const path = credentialsPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(path, {
      realpath: false,
      stale: CREDENTIALS_LOCK_STALE_MS,
      update: CREDENTIALS_LOCK_STALE_MS / 3,
      retries: {
        retries: Math.ceil(CREDENTIALS_LOCK_WAIT_MS / CREDENTIALS_LOCK_POLL_MS),
        factor: 1,
        minTimeout: CREDENTIALS_LOCK_POLL_MS,
        maxTimeout: CREDENTIALS_LOCK_POLL_MS,
        randomize: false,
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new ProfileConfigError(
        'Another sim process is updating the stored login. Wait for it to finish and retry.'
      )
    }
    throw error
  }

  try {
    return await heldLock.run(true, work)
  } finally {
    await release()
  }
}

/** Drops the profile from both files. Returns whether anything was removed. */
export function deleteProfile(profile: string): { config: boolean; credentials: boolean } {
  const credentialsDoc = readIni(credentialsPath())
  const credentials = removeSection(credentialsDoc, profile)
  if (credentials) writeIni(credentialsPath(), credentialsDoc, true)

  const configDoc = readIni(configPath())
  const config = removeSection(configDoc, configSectionName(profile))
  if (config) writeIni(configPath(), configDoc, false)

  return { config, credentials }
}

/**
 * Validates an endpoint and strips its trailing slashes.
 *
 * The check has to live here rather than at the call sites because an endpoint
 * reaches the HTTP client from four directions — `--endpoint`, `SIM_ENDPOINT`,
 * `configure --set-endpoint`, and a hand-edited `~/.sim/config` — and an
 * unparseable one escapes as a raw `TypeError: Invalid URL` stack trace from
 * inside Node's URL parser instead of a CLI error.
 *
 * `source` names where the value came from, so the message points at the thing
 * the user has to edit.
 */
export function normalizeEndpoint(endpoint: string, source: string): string {
  // Surrounding whitespace is stripped first, and for the same reason as in
  // `normalizeWorkspaceId`: `new URL()` tolerates padding and hands the padded
  // string straight back, but the config writer refuses it. Without this,
  // `login --endpoint " https://…"` failed *after* the device flow had already
  // minted a key, discarding it and reporting a file-format problem instead of
  // naming the flag. It also has to come first so the slash strip sees the real
  // end of the URL — and that strip is there because a trailing slash produces
  // `https://sim.ai//api/v2/...`, which some proxies 404 rather than normalize.
  const trimmed = endpoint.trim().replace(/\/+$/, '')

  // Trimming only reaches the ends, and a control character in the middle is
  // the one that matters: the URL parser deletes tabs and line breaks from
  // anywhere in its input before parsing it, so a string whose visible text
  // names one host can resolve to a different authority — and the resolved one
  // is where the API key is sent. Refusing the whole forbidden set here means
  // the endpoint this function blesses is the endpoint every later parse sees.
  //
  // A character check rather than parse-and-compare: comparing `trimmed`
  // against `parsed.href` would also reject legitimate endpoints, because the
  // parser rewrites percent-encoding, lowercases the scheme and host,
  // punycodes an IDN, and drops a default port. The forbidden set is instead a
  // strict superset of the characters the parser silently removes, so it is
  // exact for this hazard — and it is `FORBIDDEN_IN_VALUE`, the same constant
  // the config writer enforces, so a value accepted here can never be refused
  // by the write that stores it.
  if (FORBIDDEN_IN_VALUE.test(trimmed)) {
    throw new ProfileConfigError(
      `Invalid endpoint "${redact(endpoint)}" from ${source}. An endpoint cannot contain line breaks or control characters.`
    )
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ProfileConfigError(
      `Invalid endpoint "${redact(endpoint)}" from ${source}. Use an absolute URL, e.g. ${DEFAULT_ENDPOINT} or http://localhost:3000`
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProfileConfigError(
      `Unsupported endpoint scheme "${parsed.protocol.replace(/:$/, '')}" from ${source}. Use http or https, e.g. ${DEFAULT_ENDPOINT}`
    )
  }

  return trimmed
}

/**
 * Validates a workspace id on its way into the config file.
 *
 * The sibling of {@link normalizeEndpoint}, and for the same reason: a stored
 * setting is read back as a real setting, so a value that could carry a line
 * break would come back as an extra setting the user never typed — including an
 * `endpoint`, which decides where the API key is sent. Only structure is
 * checked, not the id's shape: ids are server-minted and the CLI has no business
 * deciding what one may look like.
 */
export function normalizeWorkspaceId(workspaceId: string, source: string): string {
  const trimmed = workspaceId.trim()
  if (!trimmed) {
    throw new ProfileConfigError(`Empty workspace id from ${source}.`)
  }
  if (FORBIDDEN_IN_VALUE.test(trimmed)) {
    throw new ProfileConfigError(
      `Invalid workspace id "${redact(trimmed)}" from ${source}. A workspace id cannot contain line breaks or control characters.`
    )
  }
  return trimmed
}

/**
 * Resolves one setting through the precedence chain, reporting where it landed.
 * Order is flags → environment → files → built-in default, the same order every
 * profile-based CLI uses: the more specific and more ephemeral the source, the
 * higher it wins.
 */
function resolve<T>(
  candidates: Array<[SettingSource, T | null | undefined]>,
  fallback: T | null,
  fallbackSource: SettingSource
): { value: T | null; source: SettingSource } {
  for (const [source, value] of candidates) {
    if (value !== null && value !== undefined && value !== '') return { value, source }
  }
  return { value: fallback, source: fallbackSource }
}

/** The root flag each override arrives from, for the refusal below to name. */
const OVERRIDE_FLAGS = {
  profile: '--profile',
  endpoint: '--endpoint',
  workspaceId: '--workspace',
} as const

/**
 * Refuses a root flag typed with a blank value.
 *
 * {@link resolve} treats the empty string as "not supplied", which is right for
 * an environment variable — an exported-but-empty `SIM_WORKSPACE` means unset —
 * but wrong for a flag the user typed: `sim --workspace "" workflows list` fell
 * through to the profile's stored workspace and ran against it, which is the
 * opposite of what asking for no workspace means. Whitespace counts as blank
 * for the same reason the config writer refuses it: nothing downstream would
 * read it back as a value.
 *
 * `--output` is not here because commander's `choices()` already refuses a
 * blank one before this runs.
 */
function refuseBlankOverrides(overrides: ProfileOverrides): void {
  for (const [key, flag] of Object.entries(OVERRIDE_FLAGS)) {
    const value = overrides[key as keyof typeof OVERRIDE_FLAGS]
    if (value !== undefined && value.trim() === '') {
      throw new ProfileOverrideError(
        `${flag} requires a value. Omit the flag to fall back to what is configured.`
      )
    }
  }
}

export function resolveProfile(overrides: ProfileOverrides = {}): ResolvedProfile {
  refuseBlankOverrides(overrides)

  const named = overrides.profile || process.env.SIM_PROFILE
  const name = named || DEFAULT_PROFILE
  if (named && !overrides.allowUnknownProfile) requireKnownProfile(named)
  // `allowUnknownProfile` means "this profile is about to be created", which is
  // the only moment the name shape is the CLI's to decide. An existing profile,
  // however it was written, keeps resolving.
  if (named && overrides.allowUnknownProfile && !listProfiles().includes(named)) {
    validateProfileName(named)
  }

  const config = readConfigProfile(name)
  const authProfile = resolveAuthenticationProfileName(name)
  const authConfig = authProfile === name ? config : readConfigProfile(authProfile)
  const credentials = readCredentialsProfile(authProfile)

  const endpoint = resolve<string>(
    [
      ['flag', overrides.endpoint],
      ['env', process.env.SIM_ENDPOINT],
      ['config', authConfig.endpoint],
    ],
    DEFAULT_ENDPOINT,
    'default'
  )

  const normalizedEndpoint = normalizeEndpoint(endpoint.value as string, endpoint.source)
  const storedOAuth = readStoredOAuth(credentials)
  const apiKey = resolve<string>(
    [
      ['flag', overrides.apiKey],
      ['env', process.env.SIM_API_KEY],
      /** Prefer the OAuth login if a hand-edited section contains both credential kinds. */
      ['credentials', storedOAuth ? null : credentials.api_key],
    ],
    null,
    'unset'
  )
  const oauth = apiKey.value === null ? storedOAuth : null
  if (oauth && oauth.issuer !== oauthIssuerForEndpoint(normalizedEndpoint)) {
    throw new ProfileConfigError(
      `The stored OAuth login belongs to ${redact(oauth.issuer)}, but this profile resolves to ${redact(normalizedEndpoint)}. OAuth logins cannot be moved between deployments; restore the original endpoint or run sim logout before changing it.`
    )
  }

  const workspaceId = resolve<string>(
    [
      ['flag', overrides.workspaceId],
      ['env', process.env.SIM_WORKSPACE],
      ['config', config.workspace],
    ],
    null,
    'unset'
  )

  const output = resolve<string>(
    [
      ['flag', overrides.output],
      ['env', process.env.SIM_OUTPUT],
      ['config', config.output],
    ],
    'table',
    'default'
  )
  if (!(OUTPUT_FORMATS as readonly string[]).includes(output.value as string)) {
    throw new ProfileConfigError(
      `Unknown output format "${redact(String(output.value))}" from ${output.source}. Use one of: ${OUTPUT_FORMATS.join(', ')}`
    )
  }

  return {
    name,
    endpoint: normalizedEndpoint,
    authProfile,
    apiKey: apiKey.value,
    oauth,
    workspaceId: workspaceId.value,
    output: output.value as OutputFormat,
    sources: {
      endpoint: endpoint.source,
      credential: oauth ? 'credentials' : apiKey.source,
      workspaceId: workspaceId.source,
      output: output.source,
    },
  }
}
