/**
 * Secrets in stored values: the one predicate print and compile share. A value holds a secret when
 * it sits in a `password` field as literal text, or when any field holds a high-confidence
 * credential: a known token format (`sk-…`, `ghp_…`, `xoxb-…`, a JWT, a private key, `Bearer …`),
 * a credential header row (`Authorization`, `X-Api-Key`), a credential-named property, code
 * assignment or URL query parameter, or a URL's userinfo password. The printer writes such a param
 * as `stored()`, so the value never lands in a file and an apply keeps the stored one; print and
 * compile both flag it with `W_LITERAL_SECRET`, since a key written into the workflow travels with
 * every copy of it where an env reference would not.
 *
 * Reference and `{{ENV}}` tokens never count: `Bearer {{TOKEN}}` and `<start.key>` are not secrets.
 */
import { isRecordLike } from '@sim/utils/object'
import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import type { ResourceKind, Value } from './model'

/** `text` with every reference and `{{ENV}}` token blanked to one space. */
function withoutReferences(text: string): string {
  const parts: string[] = []
  let at = 0
  for (const token of findWorkflowReferenceTokens(text)) {
    if (token.start < at) continue
    parts.push(text.slice(at, token.start), ' ')
    at = token.end
  }
  parts.push(text.slice(at))
  return parts.join('')
}

/**
 * A value in a password field that holds literal text: anything but `null`, `''` or text made
 * only of reference and `{{ENV}}` tokens.
 */
export function isLiteralSecret(value: Value): boolean {
  if (value === null || value === '') return false
  if (typeof value !== 'string') return true
  return withoutReferences(value).trim() !== ''
}

/** Token formats whose shape alone marks a credential. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:proj-|ant-[a-z0-9]+-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bxox[abposre]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /\bnpm_[A-Za-z0-9]{36}/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
  // Starts only where a run of token characters starts, so a long run of `-eyJ` is scanned once.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/,
]

/**
 * Names (lowercased, separators removed) whose value is a credential: header names, properties,
 * code variables and query parameters alike.
 */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxyauthorization',
  'apikey',
  'xapikey',
  'apitoken',
  'xapitoken',
  'apisecret',
  'authtoken',
  'xauthtoken',
  'accesstoken',
  'xaccesstoken',
  'refreshtoken',
  'bearertoken',
  'privatetoken',
  'privatekey',
  'secretkey',
  'secretaccesskey',
  'clientsecret',
  'password',
  'passwd',
  'token',
  'secret',
])

function isCredentialName(name: string): boolean {
  return CREDENTIAL_NAMES.has(name.toLowerCase().replace(/[^a-z0-9]/g, ''))
}

/** Values that stand in for a secret rather than being one. */
const PLACEHOLDER =
  /^(?:x+|\*+|\.+|-+|_+|<[^>]*>|\[[^\]]*\]|your\w*|my\w*|example\w*|placeholder\w*|changeme|redacted|secret|password|token|null|undefined|none|true|false)$/i

/** An auth scheme word that may open a credential header's value (`Bearer {{TOKEN}}`). */
const AUTH_SCHEME = /^\s*(?:bearer|basic|token|bot|digest|apikey|key)\s+/i

/**
 * A credential header's value without its leading auth scheme word, so only what follows it
 * (`{{TOKEN}}` in `Digest {{TOKEN}}`) is judged a literal secret. The one scheme list workflows and
 * workspace declarations share.
 */
export function withoutAuthScheme(value: string): string {
  return value.replace(AUTH_SCHEME, '')
}

/**
 * Whether literal text in a credential slot (a credential header's value, a credential-named
 * property) is a secret: at least 8 characters with no whitespace once the auth scheme and
 * reference tokens are gone, and not a placeholder.
 */
function isCredentialText(text: string): boolean {
  const literal = withoutAuthScheme(withoutReferences(text).trim()).trim()
  return literal.length >= 8 && !/\s/.test(literal) && !PLACEHOLDER.test(literal)
}

/**
 * A credential-shaped assignment value (code, JSON text, a query string): a literal that is not a
 * placeholder and holds a digit, or is long enough to be random.
 */
function isAssignedSecret(literal: string): boolean {
  return (
    literal.length >= 8 &&
    !PLACEHOLDER.test(literal) &&
    (/\d/.test(literal) || literal.length >= 20)
  )
}

/** Identifiers in code or JSON text, matched one after another so the scan stays linear. */
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_-]*/g

/** After a credential name: `: "…"`, `= '…'`, `": "…"`, the quoted literal captured. */
const ASSIGNED_VALUE = /["']?[ \t]{0,8}[:=][ \t]{0,8}(["'`])([^"'`\s]{8,512})\1/y

/** `?api_key=…` / `&token=…` in a URL. */
const QUERY_PARAM = /[?&]([A-Za-z_][A-Za-z0-9_-]{0,63})=([^&#\s"'`]{1,512})/g

/** What follows `://` when the URL carries `user:password@`. */
const URL_USERINFO = /[^\s/:@"'`]{1,256}:([^\s/@"'`]{1,256})@/y

/**
 * Whether text holds a credential. Every scan is linear in the text: a hostile value of megabytes
 * must not stall print or compile.
 */
function textHoldsSecret(text: string): boolean {
  const literal = withoutReferences(text)
  if (TOKEN_PATTERNS.some((pattern) => pattern.test(literal))) return true
  for (const match of literal.matchAll(IDENTIFIER)) {
    if (!isCredentialName(match[0])) continue
    ASSIGNED_VALUE.lastIndex = match.index + match[0].length
    const assigned = ASSIGNED_VALUE.exec(literal)
    if (assigned?.[2] !== undefined && isAssignedSecret(assigned[2])) return true
  }
  for (const match of literal.matchAll(QUERY_PARAM)) {
    if (isCredentialName(match[1]) && isAssignedSecret(match[2])) return true
  }
  for (let at = literal.indexOf('://'); at !== -1; at = literal.indexOf('://', at + 3)) {
    URL_USERINFO.lastIndex = at + 3
    const userinfo = URL_USERINFO.exec(literal)
    if (userinfo?.[1] !== undefined && !PLACEHOLDER.test(userinfo[1])) return true
  }
  return false
}

/** The name and value of a `{ Key, Value }` / `{ name, value }` row (headers, query params). */
function rowEntry(record: Record<string, unknown>): { name: string; value: unknown } | null {
  const cells = isRecordLike(record.cells) ? record.cells : record
  const name = cells.Key ?? cells.key ?? cells.name ?? cells.Name ?? cells.header
  const value = cells.Value ?? cells.value
  return typeof name === 'string' ? { name, value } : null
}

function detect(value: unknown, depth: number): boolean {
  if (depth > 64 || value === null || value === undefined) return false
  if (typeof value === 'string') return textHoldsSecret(value)
  if (Array.isArray(value)) return value.some((item) => detect(item, depth + 1))
  if (!isRecordLike(value) || Object.hasOwn(value, '$sim')) return false
  const row = rowEntry(value)
  if (row && isCredentialName(row.name) && typeof row.value === 'string') {
    if (isCredentialText(row.value)) return true
  }
  for (const [key, item] of Object.entries(value)) {
    if (isCredentialName(key) && typeof item === 'string' && isCredentialText(item)) return true
    if (detect(item, depth + 1)) return true
  }
  return false
}

/**
 * Whether a value outside a password field holds a high-confidence credential anywhere in it: a
 * token format in any string, or literal text under a credential name.
 */
export function holdsDetectedSecret(value: unknown): boolean {
  return detect(value, 0)
}

/**
 * Whether a stored param holds a secret: literal text in a password field, else a detected
 * credential anywhere in it. Print writes such a param as `stored()`; print and compile warn.
 */
export function holdsSecret(field: { password?: boolean } | undefined, value: Value): boolean {
  return field?.password ? isLiteralSecret(value) : holdsDetectedSecret(value)
}

/** The traits of the field a `W_LITERAL_SECRET` finding is about. */
interface SecretField {
  password?: boolean
  /** Set on a resource selector; a `credential` one takes `credential('<key>')`. */
  resourceKind?: ResourceKind
}

/**
 * The message and hint of `W_LITERAL_SECRET` for the param written as `name`: a password field's,
 * a credential selector holding a literal token, or a credential detected in another field.
 */
export function literalSecretFinding(
  name: string,
  field: SecretField = { password: true }
): { message: string; hint: string } {
  if (field.password) {
    return {
      message: `${name} holds a literal secret instead of an env reference; write ${name}: env.NAME.`,
      hint: `Store the secret as a workspace or personal env variable and write ${name}: env.NAME, so the key never sits in the workflow.`,
    }
  }
  if (field.resourceKind === 'credential') {
    return {
      message: `${name} holds what looks like a literal token instead of a saved credential; get prints it as stored() so it never lands in a file.`,
      hint: `Save the token as a workspace credential and write ${name}: credential('<key>'), so the token never sits in the workflow.`,
    }
  }
  return {
    message: `${name} holds what looks like a literal credential; get prints it as stored() so it never lands in a file.`,
    hint: 'Store the credential as a workspace or personal env variable and interpolate env.NAME into the value in a t template, so the key never sits in the workflow.',
  }
}
