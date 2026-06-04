import { createHash, createPublicKey } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { importPKCS8, SignJWT } from 'jose'
import { z } from 'zod'
import { sleepUntilAborted } from '@/lib/data-drains/destinations/utils'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainSnowflakeDestination')

/**
 * Snowflake account identifier formats (https://docs.snowflake.com/en/user-guide/admin-account-identifier):
 * - Org-account: `<orgname>-<acctname>` — alphanumerics/underscore, hyphen-separated, no dots.
 * - Legacy account locator: `<locator>` or `<locator>.<region>[.<cloud>]` — dots allowed.
 */
const ACCOUNT_ORG_RE = /^[A-Za-z0-9][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+$/
/**
 * First segment allows hyphens so org-account identifiers (`<orgname>-<acctname>`)
 * carrying a legacy region/cloud suffix (e.g. `myorg-acct.us-east-1.aws`) match.
 * `normalizeAccountForJwt` strips the dotted suffix for JWT `iss`/`sub`.
 */
const ACCOUNT_LOCATOR_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*){0,2}$/
function isValidAccount(v: string): boolean {
  return ACCOUNT_ORG_RE.test(v) || ACCOUNT_LOCATOR_RE.test(v)
}
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,254}$/
/** JWT lifetime; Snowflake caps server-side enforcement at 60 minutes regardless of `exp`. */
const JWT_LIFETIME_SECONDS = 55 * 60
/** Safety margin (in seconds) subtracted from the JWT exp when caching. */
const JWT_CACHE_SAFETY_MARGIN_SECONDS = 300
const PER_ATTEMPT_TIMEOUT_MS = 60_000
const POLL_INITIAL_INTERVAL_MS = 500
const POLL_MAX_INTERVAL_MS = 5_000
const POLL_DEADLINE_MS = 10 * 60_000
/**
 * Cap on consecutive failed poll attempts (network errors or retryable HTTP
 * statuses). Independent of the 10-minute wall-clock deadline so that
 * persistent failures surface in seconds, not minutes — matches the
 * MAX_ATTEMPTS shape used by `executeStatement`. Reset to 0 on a successful
 * 202 (still-executing) response.
 */
const POLL_MAX_CONSECUTIVE_RETRIES = 8
/** Maximum number of attempts (including the initial attempt) for retryable POST failures. */
const EXECUTE_MAX_ATTEMPTS = 3
const EXECUTE_RETRY_BASE_DELAY_MS = 500
const EXECUTE_RETRY_MAX_DELAY_MS = 5_000
/** Conservative pre-2025_03 BCR VARIANT max size (16 MiB) so the same value works on every account. */
const VARIANT_MAX_BYTES = 16 * 1024 * 1024
/** Server-side statement execution timeout (seconds) sent in the SQL API request body. */
const SQL_API_TIMEOUT_SECONDS = 600

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
  account: z.string().min(3, 'account is required').refine(isValidAccount, {
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
  /** Target VARIANT column. Defaults to `DATA` (uppercase, matching Snowflake's unquoted identifier folding). */
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
  let privateKey: Awaited<ReturnType<typeof importPKCS8>>
  try {
    privateKey = await importPKCS8(privateKeyPem, 'RS256')
  } catch (error) {
    throw new Error(
      `privateKey must be an unencrypted PKCS#8 PEM (-----BEGIN PRIVATE KEY-----). ` +
        `Convert PKCS#1 with: openssl pkcs8 -topk8 -nocrypt -in rsa.pem -out pkcs8.pem. ` +
        `Decrypt encrypted PEMs first. Underlying error: ${toError(error).message}`
    )
  }
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
  const column = quoteIdentifier(config.column ?? 'DATA')
  const target = `${quoteIdentifier(config.database)}.${quoteIdentifier(config.schema)}.${quoteIdentifier(config.table)}`
  const placeholders = Array.from({ length: rowCount }, () => '(PARSE_JSON(?))').join(', ')
  return `INSERT INTO ${target} (${column}) VALUES ${placeholders}`
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

interface ExecuteInput {
  config: SnowflakeDestinationConfig
  getJwt: () => Promise<string>
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
  const baseUrl = `https://${input.config.account}.snowflakecomputing.com/api/v2/statements`
  const bindings: Record<string, { type: 'TEXT'; value: string }> = {}
  input.bindings.forEach((value, index) => {
    bindings[(index + 1).toString()] = { type: 'TEXT', value }
  })
  const body = {
    statement: input.statement,
    timeout: SQL_API_TIMEOUT_SECONDS,
    warehouse: input.config.warehouse,
    role: input.config.role,
    bindings,
  }
  const serializedBody = JSON.stringify(body)
  /** Stable per-request UUID enables idempotent retries via `retry=true` on subsequent attempts. */
  const requestId = generateId()

  let lastError: unknown
  for (let attempt = 1; attempt <= EXECUTE_MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    /** Acquire JWT before starting the per-attempt timer so token signing doesn't eat the network budget (mirrors pollStatement). */
    const jwt = await input.getJwt()
    const perAttempt = AbortSignal.any([input.signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
    const params = new URLSearchParams({ requestId })
    if (attempt > 1) params.set('retry', 'true')
    const url = `${baseUrl}?${params.toString()}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
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
      await sleepUntilAborted(
        backoffWithJitter(attempt, null, {
          baseMs: EXECUTE_RETRY_BASE_DELAY_MS,
          maxMs: EXECUTE_RETRY_MAX_DELAY_MS,
        }),
        input.signal
      )
      continue
    }
    if (response.status === 202) {
      const json = (await response.json().catch(() => ({}))) as { statementHandle?: string }
      if (!json.statementHandle) {
        throw new Error('Snowflake returned 202 without a statementHandle')
      }
      await pollStatement({
        account: input.config.account,
        getJwt: input.getJwt,
        handle: json.statementHandle,
        signal: input.signal,
      })
      return
    }
    if (response.ok) {
      /**
       * Synchronous completions return 200 — same statement-level error envelope as
       * the polled 200 path, so check `sqlState` here too instead of silently passing
       * failures. Consuming the body also lets undici reuse the socket.
       */
      const completion = (await response.json().catch(() => ({}))) as {
        code?: string
        sqlState?: string
        message?: string
      }
      if (completion.sqlState && completion.sqlState !== '00000') {
        throw new Error(
          `Snowflake statement failed (sqlState ${completion.sqlState}${completion.code ? `, code ${completion.code}` : ''}): ${completion.message ?? ''}`
        )
      }
      return
    }
    const text = await response.text().catch(() => '')
    const error = new Error(`Snowflake responded with HTTP ${response.status}: ${text}`)
    if (!isRetryableStatus(response.status) || attempt === EXECUTE_MAX_ATTEMPTS) throw error
    lastError = error
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
    const delay = backoffWithJitter(attempt, retryAfterMs, {
      baseMs: EXECUTE_RETRY_BASE_DELAY_MS,
      maxMs: EXECUTE_RETRY_MAX_DELAY_MS,
    })
    logger.warn('Snowflake request retrying after retryable status', {
      attempt,
      status: response.status,
      delayMs: delay,
    })
    await sleepUntilAborted(delay, input.signal)
  }
  throw lastError ?? new Error('Snowflake request failed after retries')
}

interface PollInput {
  account: string
  /** Thunk so long polls (past 55min) refresh the JWT instead of dying with 401. */
  getJwt: () => Promise<string>
  handle: string
  signal: AbortSignal
}

/** Snowflake returns 202 while still executing and 200 on completion (async statement-handle semantics). */
async function pollStatement(input: PollInput): Promise<void> {
  const url = `https://${input.account}.snowflakecomputing.com/api/v2/statements/${encodeURIComponent(input.handle)}`
  const deadline = Date.now() + POLL_DEADLINE_MS
  let interval = POLL_INITIAL_INTERVAL_MS
  let skipIntervalSleep = true
  let retryAttempt = 0
  while (Date.now() < deadline) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    if (!skipIntervalSleep) {
      await sleepUntilAborted(interval, input.signal)
    }
    skipIntervalSleep = false
    const jwt = await input.getJwt()
    const perAttempt = AbortSignal.any([input.signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        },
        signal: perAttempt,
      })
    } catch (error) {
      if (input.signal.aborted) throw error
      retryAttempt++
      if (retryAttempt > POLL_MAX_CONSECUTIVE_RETRIES) throw error
      const delay = backoffWithJitter(retryAttempt, null, {
        baseMs: EXECUTE_RETRY_BASE_DELAY_MS,
        maxMs: EXECUTE_RETRY_MAX_DELAY_MS,
      })
      logger.warn('Snowflake poll request failed, retrying', {
        attempt: retryAttempt,
        delayMs: delay,
        error: toError(error).message,
      })
      await sleepUntilAborted(delay, input.signal)
      skipIntervalSleep = true
      continue
    }
    if (response.status === 202) {
      /** Drain the body so undici can return the socket to the keep-alive pool between polls. */
      await response.text().catch(() => '')
      retryAttempt = 0
      interval = Math.min(interval * 2, POLL_MAX_INTERVAL_MS)
      continue
    }
    if (isRetryableStatus(response.status)) {
      retryAttempt++
      if (retryAttempt > POLL_MAX_CONSECUTIVE_RETRIES) {
        /** Drain the body so undici can return the socket to the keep-alive pool. */
        const text = await response.text().catch(() => '')
        throw new Error(
          `Snowflake poll failed after ${POLL_MAX_CONSECUTIVE_RETRIES} consecutive retries (HTTP ${response.status}): ${text}`
        )
      }
      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
      const delay = backoffWithJitter(retryAttempt, retryAfterMs, {
        baseMs: EXECUTE_RETRY_BASE_DELAY_MS,
        maxMs: EXECUTE_RETRY_MAX_DELAY_MS,
      })
      logger.warn('Snowflake poll retrying after retryable status', {
        attempt: retryAttempt,
        status: response.status,
        delayMs: delay,
      })
      /** Drain the body so undici can return the socket to the keep-alive pool between retries. */
      await response.text().catch(() => '')
      await sleepUntilAborted(delay, input.signal)
      skipIntervalSleep = true
      continue
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Snowflake poll failed (HTTP ${response.status}): ${text}`)
    }
    /**
     * Snowflake SQL API can return 200 with a statement-level error envelope
     * (`code` / `sqlState` / `message`). Successful completions return
     * `code === "090001"` ("statement executed successfully") or omit `code`,
     * while statement errors come back with codes like `"002032"` and
     * a populated `sqlState`. Treat anything with a `sqlState` as a failure.
     */
    const completion = (await response.json().catch(() => ({}))) as {
      code?: string
      sqlState?: string
      message?: string
    }
    if (completion.sqlState && completion.sqlState !== '00000') {
      throw new Error(
        `Snowflake statement failed (sqlState ${completion.sqlState}${completion.code ? `, code ${completion.code}` : ''}): ${completion.message ?? ''}`
      )
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
    let cached: JwtCacheEntry | null = null
    async function getJwt(): Promise<string> {
      const now = Math.floor(Date.now() / 1000)
      if (cached && cached.expiresAt > now) return cached.token
      cached = await buildJwt(config.account, config.user, credentials.privateKey)
      return cached.token
    }
    await executeStatement({
      config,
      getJwt,
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
        /**
         * Bind the original line bytes — not `JSON.stringify(JSON.parse(line))` —
         * so JSON numbers outside the JS safe-integer range (e.g. Snowflake
         * NUMBER columns past 2^53-1) survive into VARIANT intact. We still
         * parse each line so a malformed payload fails fast at the runner.
         */
        const text = body.toString('utf8')
        const rows: string[] = []
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line.length === 0) continue
          try {
            JSON.parse(line)
          } catch (error) {
            throw new Error(
              `Snowflake NDJSON parse failed at line ${i + 1}: ${toError(error).message}`
            )
          }
          rows.push(line)
        }
        if (rows.length === 0) {
          return {
            locator: `snowflake://${config.account}/${config.database}.${config.schema}.${config.table}#${metadata.runId}-${metadata.sequence}`,
          }
        }
        await executeStatement({
          config,
          getJwt,
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
