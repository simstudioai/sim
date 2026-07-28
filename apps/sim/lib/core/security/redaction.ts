/**
 * Centralized redaction utilities for sensitive data
 */

import { filterUserFileForDisplay, isUserFile } from '@/lib/core/utils/user-file'

export const REDACTED_MARKER = '[REDACTED]'
export const TRUNCATED_MARKER = '[TRUNCATED]'

/** Keys that contain large binary/encoded data that should be truncated in logs */
const LARGE_DATA_KEYS = new Set(['base64'])

/**
 * Pagination cursors. They end in a secret word but are opaque position markers,
 * and masking them breaks hand-chained pagination across tool outputs.
 */
const NON_SENSITIVE_KEYS = new Set([
  'next_page_token',
  'next_token',
  'page_token',
  'continuation_token',
  'sync_token',
  'fetch_xml_paging_cookie',
])

/**
 * Words that carry a secret when they end a key, and whose `<word>Url` /
 * `<word>Link` locator is as sensitive as the secret itself: `resetPasswordUrl`
 * is a one-shot account-takeover link, `accessTokenUrl` hands out a bearer token.
 *
 * Anchored on a separator so a secret word is caught in any position
 * (`openai_api_key`, `x-api-key`, `secretAccessKey`) while record identifiers
 * that merely contain `key` (`issueKey`, `partitionKey`, `keyPoints`) stay
 * readable. `…Key` is only a credential behind an explicit qualifier — vendor
 * names are listed because `<vendor>Key` is conventionally that vendor's secret.
 *
 * `token` stays singular: `promptTokens`/`totalTokens` are usage counters, so
 * plural forms are enumerated only where they are unambiguously credentials.
 */
const SECRET_LOCATOR_WORDS = [
  'api_?keys?',
  '(?:access|anthropic|app|auth|client|decryption|deploy|encryption|license|master|openai|private|resend|root|secret|sendgrid|sign|signing|stripe|twilio)_keys?',
  'secrets?',
  'passwords?',
  'token',
  '(?:access|api|auth|bearer|id|refresh|session)_tokens',
  'credentials?',
].join('|')

/**
 * Secret words with no meaningful locator form. Kept out of the locator group so
 * `authorizationUrl`, `authorizationEndpoint`, and `BETTER_AUTH_URL` stay
 * readable — an OIDC authorization endpoint is published discovery metadata.
 */
const SECRET_WORDS_ONLY = [
  'passwd',
  'passphrase',
  'authorization',
  'auth',
  'bearer',
  'cookies?',
  'jwt',
  'pem',
  'ssn',
  'connection_string',
  'service_account_json',
  'code_verifier',
  'kubeconfig',
].join('|')

const SECRET_WORDS = `${SECRET_LOCATOR_WORDS}|${SECRET_WORDS_ONLY}`

/**
 * One-shot credential locators. The token is embedded in the URL path rather
 * than named by the key, so `activationUrl` leaks exactly what the redacted
 * `activationToken` beside it protects. Scoped to single-use flows so ordinary
 * `*Url` fields stay readable.
 */
const ONE_SHOT_LOCATOR_WORDS =
  'activation|invitation|invite|magic|reset|verification|verify|confirmation|confirm'

const SECRET_LOCATOR_SUFFIXES = 'url|uri|endpoint|link'

/**
 * `…_value` behind a secret word is the plaintext secret, not its name — a
 * secrets-manager record is `{ secretKey, secretValue }` and the value half is
 * the one that must never reach a log.
 */
const SENSITIVE_KEY_PATTERN = new RegExp(
  `(?:^|_)(?:(?:${SECRET_WORDS})(?:_value)?|(?:${SECRET_LOCATOR_WORDS}|${ONE_SHOT_LOCATOR_WORDS})_(?:${SECRET_LOCATOR_SUFFIXES}))$`
)

/**
 * Long, unambiguous secret words matched at the end of the separator-stripped
 * key, so an unpunctuated concatenation (`dbpassword`, `xclientsecret`) is still
 * caught. Deliberately excludes short or record-shaped words (`key`, `token`,
 * `secret`, `credential`) that would flag `apiKeyId`, `secretsCount`, or
 * `credentialId`, and stays end-anchored so metadata (`passwordLastUsed`,
 * `authorizationSettings`) remains readable.
 */
const SENSITIVE_SUBSTRING =
  /(?:password|passwd|passphrase|privatekey|accesstoken|refreshtoken|clientsecret|connectionstring|authorization|kubeconfig)$/

const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g
/**
 * Only the final uppercase char before the boundary matters — it is copied
 * straight back as `$1`. A `[A-Z]+` prefix here would backtrack the whole
 * uppercase run at every start offset, making an attacker-supplied key name a
 * quadratic event-loop stall.
 */
const ACRONYM_BOUNDARY = /([A-Z])([A-Z][a-z])/g
const NON_ALPHANUMERIC = /[^a-z0-9]+/g

/**
 * Lowercases a key and collapses camelCase, acronym, and punctuation boundaries
 * to `_`, so one set of `_`-anchored patterns covers every casing convention.
 * `secretAccessKey` / `x-api-key` -> `secret_access_key` / `x_api_key`.
 */
function normalizeKey(key: string): string {
  return key
    .replace(CAMEL_BOUNDARY, '$1_$2')
    .replace(ACRONYM_BOUNDARY, '$1_$2')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, '_')
}

/**
 * Keys naming a collection of credential records rather than a secret. Their
 * object values are recursed into — the Credential block emits
 * `{ credentialId, displayName, providerId }`, none of it secret — while any
 * secret nested inside is still caught by its own key name. A scalar under one
 * of these keys is still redacted.
 */
const CREDENTIAL_CONTAINER_KEYS = new Set(['credential', 'credentials'])

function isCredentialContainerKey(key: string): boolean {
  return CREDENTIAL_CONTAINER_KEYS.has(normalizeKey(key))
}

/**
 * Credential shapes recognizable from the value alone, regardless of the key
 * that carries them. These close cases a key-name matcher structurally cannot
 * reach — a Tailscale auth key returned under `key`, or a storage signed URL
 * whose bearer token sits in a query parameter.
 *
 * Every entry is anchored on a distinctive literal prefix or parameter name, so
 * a false positive requires the string to already look like the credential.
 */
const CREDENTIAL_LITERAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  /** Tailscale keys: tskey-auth-…, tskey-api-…, tskey-client-…. */
  {
    pattern: /\btskey-[a-z]{3,10}-[A-Za-z0-9]{8,}(?:-[A-Za-z0-9]+)?/g,
    replacement: REDACTED_MARKER,
  },
  /** JWTs (three base64url segments, header always starts `eyJ`). */
  {
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
    replacement: REDACTED_MARKER,
  },
  /** Bearer-equivalent query parameters on signed URLs; the path stays visible. */
  {
    pattern:
      /([?&](?:token|sig|signature|x-amz-signature|x-goog-signature)=)[A-Za-z0-9%._~+/-]{8,}/gi,
    replacement: `$1${REDACTED_MARKER}`,
  },
]

/**
 * Patterns for sensitive values in strings (for redacting values, not keys)
 */
const SENSITIVE_VALUE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  ...CREDENTIAL_LITERAL_PATTERNS,
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: `Bearer ${REDACTED_MARKER}`,
  },
  {
    pattern: /Basic\s+[A-Za-z0-9+/]+=*/gi,
    replacement: `Basic ${REDACTED_MARKER}`,
  },
  /** API keys that look like sk-…, pk-…, api_…. */
  {
    pattern: /\b(sk|pk|api|key)[_-][A-Za-z0-9\-._]{20,}\b/gi,
    replacement: REDACTED_MARKER,
  },
  {
    pattern: /password['":\s]*['"][^'"]+['"]/gi,
    replacement: `password: "${REDACTED_MARKER}"`,
  },
  {
    pattern: /token['":\s]*['"][^'"]+['"]/gi,
    replacement: `token: "${REDACTED_MARKER}"`,
  },
  {
    pattern: /api[_-]?key['":\s]*['"][^'"]+['"]/gi,
    replacement: `api_key: "${REDACTED_MARKER}"`,
  },
]

/** Whether a key name alone marks it a credential; the value is gated separately. */
export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (NON_SENSITIVE_KEYS.has(normalized)) return false
  if (SENSITIVE_KEY_PATTERN.test(normalized)) return true
  return SENSITIVE_SUBSTRING.test(normalized.replaceAll('_', ''))
}

/**
 * A boolean can never carry a credential, so a secret-sounding key holding one
 * is a presence flag (`customSigningKey: false`, `withCredentials: true`) and
 * stays readable.
 */
function isRedactableValue(value: unknown): boolean {
  return typeof value !== 'boolean'
}

/**
 * Redacts sensitive patterns from a string value
 * @param value - The string to redact
 * @returns The string with sensitive patterns redacted
 */
export function redactSensitiveValues(value: string): string {
  if (!value || typeof value !== 'string') {
    return value
  }

  let result = value
  for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function isLargeDataKey(key: string): boolean {
  return LARGE_DATA_KEYS.has(key)
}

export function redactApiKeys(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'string') {
    return redactSensitiveValues(obj)
  }

  if (typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactApiKeys(item))
  }

  if (isUserFile(obj)) {
    const filtered = filterUserFileForDisplay(obj)
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(filtered)) {
      if (isLargeDataKey(key) && typeof value === 'string') {
        result[key] = TRUNCATED_MARKER
      } else if (typeof value === 'string') {
        result[key] = redactSensitiveValues(value)
      } else {
        result[key] = value
      }
    }
    return result
  }

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (isCredentialContainerKey(key) && typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else if (isSensitiveKey(key) && isRedactableValue(value)) {
      result[key] = REDACTED_MARKER
    } else if (isLargeDataKey(key) && typeof value === 'string') {
      result[key] = TRUNCATED_MARKER
    } else {
      result[key] = redactApiKeys(value)
    }
  }

  return result
}

/**
 * Sanitizes a string for safe logging by truncating and redacting sensitive patterns
 *
 * @param value - The string to sanitize
 * @param maxLength - Maximum length of the output (default: 100)
 * @returns The sanitized string
 */
export function sanitizeForLogging(value: string, maxLength = 100): string {
  if (!value) return ''

  return redactSensitiveValues(value.substring(0, maxLength))
}

/**
 * Sanitizes event data for error reporting/analytics
 *
 * @param event - The event data to sanitize
 * @returns Sanitized event data safe for external reporting
 */
export function sanitizeEventData(event: any): any {
  if (event === null || event === undefined) {
    return event
  }

  if (typeof event === 'string') {
    return redactSensitiveValues(event)
  }

  if (typeof event !== 'object') {
    return event
  }

  if (Array.isArray(event)) {
    return event.map((item) => sanitizeEventData(item))
  }

  if (isUserFile(event)) {
    const filtered = filterUserFileForDisplay(event)
    const file: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(filtered)) {
      if (isLargeDataKey(key) && typeof value === 'string') {
        file[key] = TRUNCATED_MARKER
      } else if (typeof value === 'string') {
        file[key] = redactSensitiveValues(value)
      } else {
        file[key] = value
      }
    }
    return file
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(event)) {
    if (isCredentialContainerKey(key) && typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeEventData(value)
      continue
    }

    if (isSensitiveKey(key) && isRedactableValue(value)) {
      continue
    }

    if (isLargeDataKey(key) && typeof value === 'string') {
      sanitized[key] = TRUNCATED_MARKER
      continue
    }

    sanitized[key] = sanitizeEventData(value)
  }

  return sanitized
}
