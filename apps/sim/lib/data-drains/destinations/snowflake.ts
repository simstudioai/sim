import { createHash, createPublicKey } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { importPKCS8, SignJWT } from 'jose'
import { z } from 'zod'
import { parseRetryAfter, sleepUntilAborted } from '@/lib/data-drains/destinations/utils'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainSnowflakeDestination')

/** Account-identifier-shaped URL host: `<orgname>-<accountname>.snowflakecomputing.com`. */
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,254}[A-Za-z0-9]$/
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,254}$/
const JWT_LIFETIME_SECONDS = 55 * 60
/** Safety margin (in seconds) subtracted from the JWT exp when caching. */
const JWT_CACHE_SAFETY_MARGIN_SECONDS = 300
const PER_ATTEMPT_TIMEOUT_MS = 60_000
const POLL_INITIAL_INTERVAL_MS = 500
const POLL_MAX_INTERVAL_MS = 5_000
const POLL_DEADLINE_MS = 10 * 60_000
/** Maximum number of attempts (including the initial attempt) for retryable POST failures. */
const EXECUTE_MAX_ATTEMPTS = 3
const EXECUTE_RETRY_BASE_DELAY_MS = 500
const EXECUTE_RETRY_MAX_DELAY_MS = 5_000
/**
 * Snowflake VARIANT max value size is 16 MiB (16,777,216 bytes) on accounts
 * before the 2025_03 behavior change bundle, and 128 MB after it. We use the
 * conservative pre-bundle limit so the same value works on every account.
 * https://docs.snowflake.com/en/release-notes/bcr-bundles/2025_03/bcr-1942
 */
const VARIANT_MAX_BYTES = 16 * 1024 * 1024

/**
 * Snowflake JWT `iss`/`sub` require the bare account identifier without any
 * region/cloud suffix. For account-locator format `xy12345.us-east-1.aws`,
 * only `XY12345` is valid; for org-account format `myorg-acct.us-east-1`,
 * only `MYORG-ACCT` is valid. Strip everything after the first dot.
 */
function normalizeAccountForJwt(account: string): string {
  const dot = account.indexOf('.')
  return (dot === -1 ? account : account.slice(0, dot)).toUpperCase()
}

const snowflakeConfigSchema = z.object({
  /**
   * Snowflake account identifier. Accepted formats:
   * - Org-account (preferred): `<orgname>-<acctname>` (no dots), e.g. `myorg-acct`
   * - Account locator: `<locator>` (no dots), e.g. `xy12345`
   * - Legacy regional locator: `<locator>.<region>.<cloud>`, e.g. `xy12345.us-east-1.aws`
   *
   * Do not include the `.snowflakecomputing.com` suffix. Modern org-account
   * identifiers must not contain dots; only legacy locator URLs use dots.
   */
  account: z
    .string()
    .min(3, 'account is required')
    .refine((v) => ACCOUNT_RE.test(v), {
      message: 'account must be the Snowflake account identifier (e.g. orgname-accountname)',
    }),
  user: z
    .string()
    .min(1, 'user is required')
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'user must be a valid Snowflake identifier',
    }),
  warehouse: z
    .string()
    .min(1)
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'warehouse must be a valid Snowflake identifier',
    }),
  database: z
    .string()
    .min(1)
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'database must be a valid Snowflake identifier',
    }),
  schema: z
    .string()
    .min(1)
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'schema must be a valid Snowflake identifier',
    }),
  table: z
    .string()
    .min(1)
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'table must be a valid Snowflake identifier',
    }),
  /** Target VARIANT column. Defaults to `data`. */
  column: z
    .string()
    .min(1)
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'column must be a valid Snowflake identifier',
    })
    .optional(),
  /** Optional Snowflake role to assume for the insert. */
  role: z
    .string()
    .min(1)
    .refine((v) => IDENTIFIER_RE.test(v), {
      message: 'role must be a valid Snowflake identifier',
    })
    .optional(),
})

const snowflakeCredentialsSchema = z.object({
  /** PKCS8-encoded RSA private key (PEM). The matching public key must be registered on the user. */
  privateKey: z.string().min(1, 'privateKey is required'),
})

export type SnowflakeDestinationConfig = z.infer<typeof snowflakeConfigSchema>
export type SnowflakeDestinationCredentials = z.infer<typeof snowflakeCredentialsSchema>

/**
 * Computes the SHA256:<base64> fingerprint of the public key derived from the
 * given private key. Snowflake encodes this in the JWT issuer claim so the
 * server can match the signature against the registered public key.
 * Reference: https://docs.snowflake.com/en/developer-guide/sql-api/authenticating
 */
function computePublicKeyFingerprint(privateKeyPem: string): string {
  const publicKey = createPublicKey({ key: privateKeyPem, format: 'pem' })
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  return `SHA256:${createHash('sha256').update(spkiDer).digest('base64')}`
}

interface JwtCacheEntry {
  token: string
  expiresAt: number
}

async function buildJwt(
  account: string,
  user: string,
  privateKeyPem: string
): Promise<JwtCacheEntry> {
  const fingerprint = computePublicKeyFingerprint(privateKeyPem)
  const accountForJwt = normalizeAccountForJwt(account)
  const userUpper = user.toUpperCase()
  const issuer = `${accountForJwt}.${userUpper}.${fingerprint}`
  const subject = `${accountForJwt}.${userUpper}`
  const now = Math.floor(Date.now() / 1000)
  const exp = now + JWT_LIFETIME_SECONDS
  const privateKey = await importPKCS8(privateKeyPem, 'RS256')
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)
  return { token, expiresAt: exp - JWT_CACHE_SAFETY_MARGIN_SECONDS }
}

/**
 * Quotes a Snowflake identifier so that whatever case the user typed is
 * preserved exactly. Without quoting, Snowflake folds unquoted identifiers
 * to uppercase, which silently breaks any table whose canonical name was
 * created with quoted mixed-case. Embedded `"` is escaped as `""`.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function buildStatement(config: SnowflakeDestinationConfig, rowCount: number): string {
  const column = quoteIdentifier(config.column ?? 'data')
  const target = `${quoteIdentifier(config.database)}.${quoteIdentifier(config.schema)}.${quoteIdentifier(config.table)}`
  const placeholders = Array.from({ length: rowCount }, () => '(PARSE_JSON(?))').join(', ')
  return `INSERT INTO ${target} (${column}) VALUES ${placeholders}`
}

function parseNdjson(body: Buffer): string[] {
  const text = body.toString('utf8')
  const lines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue
    lines.push(line)
  }
  return lines
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

interface ExecuteInput {
  config: SnowflakeDestinationConfig
  jwt: string
  statement: string
  bindings: string[]
  signal: AbortSignal
}

async function executeStatement(input: ExecuteInput): Promise<void> {
  for (const value of input.bindings) {
    const bytes = Buffer.byteLength(value, 'utf8')
    if (bytes > VARIANT_MAX_BYTES) {
      throw new Error(
        `Snowflake VARIANT value exceeds 16 MB limit (got ${bytes} bytes); split the row before delivery`
      )
    }
  }
  const url = `https://${input.config.account}.snowflakecomputing.com/api/v2/statements`
  const bindings: Record<string, { type: 'TEXT'; value: string }> = {}
  input.bindings.forEach((value, index) => {
    bindings[(index + 1).toString()] = { type: 'TEXT', value }
  })
  const body = {
    statement: input.statement,
    warehouse: input.config.warehouse,
    database: input.config.database,
    schema: input.config.schema,
    role: input.config.role,
    bindings,
  }
  const serializedBody = JSON.stringify(body)

  let lastError: unknown
  for (let attempt = 1; attempt <= EXECUTE_MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    const perAttempt = AbortSignal.any([input.signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.jwt}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
          'User-Agent': 'sim-data-drain/1.0',
        },
        body: serializedBody,
        signal: perAttempt,
      })
    } catch (error) {
      lastError = error
      logger.warn('Snowflake request failed', {
        attempt,
        error: toError(error).message,
      })
      if (input.signal.aborted || attempt === EXECUTE_MAX_ATTEMPTS) throw error
      await sleepUntilAborted(computeBackoffDelay(attempt), input.signal)
      continue
    }
    if (response.status === 202) {
      const json = (await response.json().catch(() => ({}))) as { statementHandle?: string }
      if (!json.statementHandle) {
        throw new Error('Snowflake returned 202 without a statementHandle')
      }
      await pollStatement({
        account: input.config.account,
        jwt: input.jwt,
        handle: json.statementHandle,
        signal: input.signal,
      })
      return
    }
    if (response.ok) return
    const text = await response.text().catch(() => '')
    const error = new Error(`Snowflake responded with HTTP ${response.status}: ${text}`)
    if (!isRetryableStatus(response.status) || attempt === EXECUTE_MAX_ATTEMPTS) throw error
    lastError = error
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
    const delay = retryAfterMs ?? computeBackoffDelay(attempt)
    logger.warn('Snowflake request retrying after retryable status', {
      attempt,
      status: response.status,
      delayMs: delay,
    })
    await sleepUntilAborted(delay, input.signal)
  }
  throw lastError ?? new Error('Snowflake request failed after retries')
}

function computeBackoffDelay(attempt: number): number {
  const exponential = EXECUTE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(exponential, EXECUTE_RETRY_MAX_DELAY_MS)
}

interface PollInput {
  account: string
  jwt: string
  handle: string
  signal: AbortSignal
}

/**
 * Polls a Snowflake statement that returned HTTP 202. Snowflake returns 202
 * again while the statement is still executing, and 200 once it completes.
 */
async function pollStatement(input: PollInput): Promise<void> {
  const url = `https://${input.account}.snowflakecomputing.com/api/v2/statements/${encodeURIComponent(input.handle)}`
  const deadline = Date.now() + POLL_DEADLINE_MS
  let interval = POLL_INITIAL_INTERVAL_MS
  while (Date.now() < deadline) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    await sleepUntilAborted(interval, input.signal)
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${input.jwt}`,
        Accept: 'application/json',
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      },
      signal: input.signal,
    })
    if (response.status === 202) {
      interval = Math.min(interval * 2, POLL_MAX_INTERVAL_MS)
      continue
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Snowflake poll failed (HTTP ${response.status}): ${text}`)
    }
    return
  }
  throw new Error('Snowflake statement did not complete within the polling deadline')
}

export const snowflakeDestination: DrainDestination<
  SnowflakeDestinationConfig,
  SnowflakeDestinationCredentials
> = {
  type: 'snowflake',
  displayName: 'Snowflake',
  configSchema: snowflakeConfigSchema,
  credentialsSchema: snowflakeCredentialsSchema,

  async test({ config, credentials, signal }) {
    const { token } = await buildJwt(config.account, config.user, credentials.privateKey)
    await executeStatement({
      config,
      jwt: token,
      statement: 'SELECT 1',
      bindings: [],
      signal,
    })
  },

  openSession({ config, credentials }) {
    let cached: JwtCacheEntry | null = null
    async function getJwt(): Promise<string> {
      const now = Math.floor(Date.now() / 1000)
      if (cached && cached.expiresAt > now) return cached.token
      cached = await buildJwt(config.account, config.user, credentials.privateKey)
      return cached.token
    }
    return {
      async deliver({ body, metadata, signal }) {
        const rows = parseNdjson(body)
        if (rows.length === 0) {
          return {
            locator: `snowflake://${config.account}/${config.database}.${config.schema}.${config.table}#${metadata.runId}-${metadata.sequence}`,
          }
        }
        const jwt = await getJwt()
        await executeStatement({
          config,
          jwt,
          statement: buildStatement(config, rows.length),
          bindings: rows,
          signal,
        })
        logger.debug('Snowflake chunk delivered', {
          account: config.account,
          table: `${config.database}.${config.schema}.${config.table}`,
          rows: rows.length,
        })
        return {
          locator: `snowflake://${config.account}/${config.database}.${config.schema}.${config.table}#${metadata.runId}-${metadata.sequence}`,
        }
      },
      async close() {},
    }
  },
}
