import { sha256Hex } from '@sim/security/hash'
import { z } from 'zod'
import { liveSearchProviderSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Live document IDs name a provider document within one of the reader's connected accounts.
 *
 * They are not an authorization boundary: every read re-resolves the account among the reader's
 * own accounts in the request's scope, then re-verifies the document with the provider and the
 * admin's source policy.
 *
 * The current form is `live2:` followed by the document's `~`-separated location fields, trailing
 * empty fields dropped, then a checksum: `live2:slack~<account>~<ts>~<channel>~~<thread ts>~<check>`.
 * Clients copy IDs verbatim into later calls, so the form stays readable (provider IDs and UUIDs
 * tokenize far better than base64 of them) and carries nothing a model must copy that does not
 * locate the document. The checksum covers the location and the reader and scope the ID was minted
 * for, so a copy that was truncated or altered, or one read by another member or in another scope,
 * is refused as not found here rather than naming a different document or reaching account
 * resolution. Earlier IDs (`live:` + base64url JSON naming the reader and scope) still read, with
 * their reader and scope checked as before.
 */
const LIVE_V1_PREFIX = 'live:'
const LIVE_V2_PREFIX = 'live2:'
const MAX_REFERENCE_LENGTH = 4000
const FIELD_SEPARATOR = '~'
const CHECKSUM_LENGTH = 6

const fieldsSchema = z
  .object({
    provider: liveSearchProviderSchema,
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

/** The reader and scope an ID is minted for and read in. */
export function liveReferenceOwner(userId: string, scope: string): string {
  return `${userId}\u0000${scope}`
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

function locationOf(reference: LiveReference): string {
  const fields = fieldsSchema.parse(reference)
  const parts = FIELD_ORDER.map((name) => {
    const value = fields[name]
    return value ? escapeField(value) : ''
  })
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts.join(FIELD_SEPARATOR)
}

function checksum(owner: string, location: string): string {
  return sha256Hex(`${owner}\u0000${location}`).slice(0, CHECKSUM_LENGTH)
}

/** Mints the current, compact ID for a provider document, for the reader and scope `owner` names. */
export function encodeLiveReference(reference: LiveReference, owner: string): string {
  const location = locationOf(reference)
  const result = `${LIVE_V2_PREFIX}${location}${FIELD_SEPARATOR}${checksum(owner, location)}`
  if (result.length > MAX_REFERENCE_LENGTH)
    throw new Error('Provider document reference is too long')
  return result
}

interface ParsedReference {
  reference: LiveReference
  /** Whether the ID was minted for the reader and scope `owner` names. */
  mintedFor: (owner: string) => boolean
}

function parseV2(value: string): ParsedReference {
  const separator = value.lastIndexOf(FIELD_SEPARATOR)
  if (separator < 0) throw new Error('Missing checksum')
  const location = value.slice(0, separator)
  const check = value.slice(separator + 1)
  const parts = location.split(FIELD_SEPARATOR)
  if (parts.length < 3 || parts.length > FIELD_ORDER.length) throw new Error('Invalid field count')
  const fields: Record<string, string> = {}
  FIELD_ORDER.forEach((name, index) => {
    const part = parts[index]
    if (part) fields[name] = unescapeField(part)
  })
  return {
    reference: fieldsSchema.parse(fields),
    mintedFor: (owner) => check === checksum(owner, location),
  }
}

function parseV1(body: string): ParsedReference {
  const { v, user, scope, ...rest } = legacySchema.parse(
    JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  )
  const fields = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined && value !== '')
  )
  return {
    reference: fieldsSchema.parse(fields),
    mintedFor: (owner) => owner === liveReferenceOwner(user, scope),
  }
}

const SEARCH_AGAIN = 'Search again to select a live document'

function parse(value: string): ParsedReference {
  try {
    if (value.length <= MAX_REFERENCE_LENGTH) {
      if (value.startsWith(LIVE_V2_PREFIX)) return parseV2(value.slice(LIVE_V2_PREFIX.length))
      if (value.startsWith(LIVE_V1_PREFIX)) return parseV1(value.slice(LIVE_V1_PREFIX.length))
    }
  } catch {}
  throw new OrchestrationError('not_found', `Invalid live document reference. ${SEARCH_AGAIN}`)
}

/**
 * The document a current or earlier live ID names, without checking whom it was minted for. Reads
 * use {@link readLiveReference}; anything that is not a live ID asks the caller to search again.
 */
export function decodeLiveReference(value: string): LiveReference {
  return parse(value).reference
}

/**
 * The document an ID names, when it was minted for the reader and scope `owner` names. A current ID
 * whose checksum does not hold for them, because it was minted for someone or somewhere else or
 * was altered, is not found in this scope.
 */
export function readLiveReference(value: string, owner: string): LiveReference {
  const { reference, mintedFor } = parse(value)
  if (!mintedFor(owner))
    throw new OrchestrationError(
      'not_found',
      value.startsWith(LIVE_V2_PREFIX)
        ? `Document not found in this search scope. ${SEARCH_AGAIN}`
        : 'Document not found in this search scope'
    )
  return reference
}

/**
 * The identity two document IDs share when they name the same document: its location, whichever
 * form the ID arrived in, or the value itself for any other ID. Compare document IDs through this,
 * never as raw strings, so a v1 ID from an earlier conversation matches the v2 ID a new search
 * returns for the same document.
 */
export function liveDocumentKey(documentId: string): string {
  if (!documentId.startsWith(LIVE_V1_PREFIX) && !documentId.startsWith(LIVE_V2_PREFIX))
    return documentId
  try {
    return `${LIVE_V2_PREFIX}${locationOf(decodeLiveReference(documentId))}`
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
