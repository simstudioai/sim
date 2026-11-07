import { sha256Hex } from '@sim/security/hash'
import { z } from 'zod'
import { liveSearchProviderSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Live document IDs name a provider document within one of the reader's connected accounts.
 *
 * They are not an authorization boundary: every read re-resolves the account among the reader's
 * own accounts in the request's scope, then re-verifies the document with the provider and the
 * admin's source policy. An ID names its reader and scope only by a short {@link liveReferenceOwner}
 * fingerprint, so a read in another scope or by another member is refused as not found in this
 * scope rather than reaching account resolution.
 *
 * The current form is `live2:` followed by `~`-separated fields, trailing empty fields dropped,
 * then a checksum: `live2:slack~<owner>~<account>~<ts>~<channel>~~<thread ts>~<checksum>`.
 * Clients copy IDs verbatim into later calls, so the form stays readable (provider IDs and UUIDs
 * tokenize far better than base64 of them) and uses only characters a model reproduces reliably.
 * Earlier IDs (`live:` + base64url JSON naming the reader and scope) still read, checked against
 * the same fingerprint.
 */
const LIVE_V1_PREFIX = 'live:'
const LIVE_V2_PREFIX = 'live2:'
const MAX_REFERENCE_LENGTH = 4000
const FIELD_SEPARATOR = '~'
const CHECKSUM_LENGTH = 6
const OWNER_LENGTH = 8

const fieldsSchema = z
  .object({
    provider: liveSearchProviderSchema,
    owner: z.string().regex(new RegExp(`^[0-9a-f]{${OWNER_LENGTH}}$`)),
    account: z.string().min(1).max(500),
    id: z.string().min(1).max(1000),
    container: z.string().min(1).max(500).optional(),
    kind: z.string().min(1).max(200).optional(),
    threadId: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional(),
    revision: z.string().min(1).max(200).optional(),
    connectionBinding: z.string().min(1).max(128).optional(),
  })
  .strict()

/** Field order of the v2 form; optional fields last so absent ones cost nothing. */
const FIELD_ORDER = [
  'provider',
  'owner',
  'account',
  'id',
  'container',
  'kind',
  'threadId',
  'revision',
  'connectionBinding',
] as const satisfies readonly (keyof z.input<typeof fieldsSchema>)[]

const legacySchema = z
  .object({
    v: z.literal(1),
    user: z.string().min(1),
    scope: z.string().min(1),
    account: z.string().min(1),
    provider: liveSearchProviderSchema,
    id: z.string().min(1).max(1000),
    container: z.string().max(500).optional(),
    kind: z.string().max(200).optional(),
    revision: z.string().max(200).optional(),
    connectionBinding: z.string().min(1).max(128).optional(),
    threadId: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional(),
  })
  .strict()

export type LiveReference = z.output<typeof fieldsSchema>

/** The reader and scope an ID was minted for, as the short fingerprint the ID carries. */
export function liveReferenceOwner(userId: string, scope: string): string {
  return sha256Hex(`${userId}\u0000${scope}`).slice(0, OWNER_LENGTH)
}

/**
 * Only the separator, the escape character and control characters are escaped, each as `%XX`;
 * every other character, Unicode included, is kept as written, so an ID is never longer than the
 * text it names and any string encodes.
 */
function escapeField(value: string): string {
  let escaped = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    escaped +=
      character === '%' || character === FIELD_SEPARATOR || code < 0x20 || code === 0x7f
        ? `%${code.toString(16).toUpperCase().padStart(2, '0')}`
        : character
  }
  return escaped
}

function unescapeField(value: string): string {
  return value.replace(/%([0-9A-F]{2})/g, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16))
  )
}

/**
 * The last field checks the others, so a copy the client truncated or altered fails to decode and
 * asks for a new search instead of naming a different document (a dropped thread or a shortened path
 * would otherwise still parse).
 */
function checksum(body: string): string {
  return sha256Hex(body).slice(0, CHECKSUM_LENGTH)
}

/** Mints the current, compact ID for a provider document. */
export function encodeLiveReference(reference: LiveReference): string {
  const fields = fieldsSchema.parse(reference)
  const parts = FIELD_ORDER.map((name) => {
    const value = fields[name]
    return value ? escapeField(value) : ''
  })
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  const body = parts.join(FIELD_SEPARATOR)
  const result = `${LIVE_V2_PREFIX}${body}${FIELD_SEPARATOR}${checksum(body)}`
  if (result.length > MAX_REFERENCE_LENGTH)
    throw new Error('Provider document reference is too long')
  return result
}

function decodeV2(value: string): LiveReference {
  const separator = value.lastIndexOf(FIELD_SEPARATOR)
  const body = value.slice(0, separator)
  if (separator < 0 || value.slice(separator + 1) !== checksum(body))
    throw new Error('Checksum mismatch')
  const parts = body.split(FIELD_SEPARATOR)
  if (parts.length < 4 || parts.length > FIELD_ORDER.length) throw new Error('Invalid field count')
  const fields: Record<string, string> = {}
  FIELD_ORDER.forEach((name, index) => {
    const part = parts[index]
    if (part) fields[name] = unescapeField(part)
  })
  return fieldsSchema.parse(fields)
}

function decodeV1(body: string): LiveReference {
  const { v, user, scope, ...rest } = legacySchema.parse(
    JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  )
  const fields = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined && value !== '')
  )
  return fieldsSchema.parse({ ...fields, owner: liveReferenceOwner(user, scope) })
}

const SEARCH_AGAIN = 'Invalid live document reference. Search again to select a live document'

/** Decodes a current or earlier live document ID; anything else asks the caller to search again. */
export function decodeLiveReference(value: string): LiveReference {
  if (value.length > MAX_REFERENCE_LENGTH) throw new OrchestrationError('not_found', SEARCH_AGAIN)
  try {
    if (value.startsWith(LIVE_V2_PREFIX)) return decodeV2(value.slice(LIVE_V2_PREFIX.length))
    if (value.startsWith(LIVE_V1_PREFIX)) return decodeV1(value.slice(LIVE_V1_PREFIX.length))
  } catch {}
  throw new OrchestrationError('not_found', SEARCH_AGAIN)
}

/**
 * The identity two document IDs share when they name the same document: the current encoding of
 * a live ID, whichever form it arrived in, or the value itself for any other ID. Compare document
 * IDs through this, never as raw strings, so a v1 ID from an earlier conversation matches the v2
 * ID a new search returns for the same document.
 */
export function liveDocumentKey(documentId: string): string {
  if (!documentId.startsWith(LIVE_V1_PREFIX) && !documentId.startsWith(LIVE_V2_PREFIX))
    return documentId
  try {
    return encodeLiveReference(decodeLiveReference(documentId))
  } catch {
    return documentId
  }
}

/** Each filter list's keys, decoded once however many results a search checks against it. */
const listKeys = new WeakMap<readonly string[], ReadonlySet<string>>()

/** Whether `documentId` names one of `documentIds`, comparing by {@link liveDocumentKey}. */
export function includesLiveDocument(documentIds: readonly string[], documentId: string): boolean {
  let keys = listKeys.get(documentIds)
  if (!keys) {
    keys = new Set(documentIds.map(liveDocumentKey))
    listKeys.set(documentIds, keys)
  }
  return keys.has(liveDocumentKey(documentId))
}
