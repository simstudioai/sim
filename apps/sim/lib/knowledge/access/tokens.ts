import { WORKSPACE_ACCESS_TOKEN } from '@/lib/knowledge/access/types'

/**
 * Shape of one access token, mirroring `doc_acl_token_shape_check` in the
 * database. `u:` carries a lowercase email; `s:` and `g:` carry three
 * colon-separated segments — provider, tenant, subject or group id — where only
 * the last may itself contain colons (Atlassian account ids do).
 */
export const ACCESS_TOKEN_PATTERN =
  /^(ws|pub|link|u:[^\nA-Z]+@[^\nA-Z]+|[gs]:[^\n:]+:[^\n:]+:[^\n]+)$/

/** Stands in for a provider that reports no tenant, so the token keeps four segments. */
export const NO_TENANT_SEGMENT = '-'

/** The ACL of a document only the workspace's uploads path or a workspace-mode connector wrote. */
export const WORKSPACE_ACL: readonly string[] = Object.freeze([WORKSPACE_ACCESS_TOKEN])

/** The ACL of a document nobody may read. */
export const EMPTY_ACL: readonly string[] = Object.freeze([])

/**
 * The most tokens one document's ACL may carry.
 *
 * Every read compares the document's ACL against the caller's token set as one
 * array overlap, so an ACL is only as cheap as it is short; a runaway one — a
 * page restricted to a five-thousand-person space, a group expanded per member
 * — degrades the GIN index for every other document in the workspace. Onyx
 * declares the same 5,000 ceiling and, by its own comment, never enforces it.
 * Ours is enforced, and a document that exceeds it fails closed rather than
 * being stored with an ACL that would have to be truncated to fit.
 */
export const MAX_ACL_TOKENS = 5000

export type AclRejection = 'malformed_token' | 'too_many_tokens'

export type AclValidation =
  | { valid: true; acl: string[] }
  | { valid: false; reason: AclRejection; sample?: string }

/**
 * Accepts an ACL a connector produced, in the canonical sorted, de-duplicated
 * form the database stores.
 *
 * The token shapes mirror `doc_acl_token_shape_check`, so a malformed token is
 * caught here — where the offending document can be named and reported — rather
 * than as a constraint violation that fails the whole batch it happened to
 * share a statement with.
 */
export function validateAcl(tokens: Iterable<string>): AclValidation {
  const acl = sortAccessTokens(tokens)
  const malformed = acl.find((token) => !isAccessToken(token))
  if (malformed !== undefined) {
    return { valid: false, reason: 'malformed_token', sample: malformed }
  }
  if (acl.length > MAX_ACL_TOKENS) {
    return { valid: false, reason: 'too_many_tokens' }
  }
  return { valid: true, acl }
}

export function isAccessToken(value: string): boolean {
  return ACCESS_TOKEN_PATTERN.test(value)
}

export interface SubjectCredential {
  providerId: string | null
  providerTenantId: string | null
  providerSubjectId: string | null
}

/**
 * The identity token of a person by the provider-attested subject on their
 * managed credential. Both the writer (a members-mode crawl) and the reader
 * (scope resolution) derive it from the same `credential` row, so no
 * source-side id format is ever compared to another.
 */
export function subjectToken(credential: SubjectCredential): string {
  const { providerId, providerSubjectId } = credential
  if (!providerId || !providerSubjectId) {
    throw new Error('A subject token requires a provider id and a provider subject id')
  }
  const tenant = credential.providerTenantId || NO_TENANT_SEGMENT
  if (providerId.includes(':') || tenant.includes(':')) {
    throw new Error('Provider and tenant segments of a subject token cannot contain ":"')
  }
  const token = `s:${providerId}:${tenant}:${providerSubjectId}`
  if (!isAccessToken(token)) {
    throw new Error(`Subject token is malformed: ${token}`)
  }
  return token
}

/**
 * The identity token of a person by their email address, as the source spells
 * it. Case-folded and trimmed on both sides — the writer mirroring a source ACL
 * and the reader resolving their own scope — so `Alice@Corp.com` in Drive and
 * `alice@corp.com` in Sim are one person.
 *
 * Returns null for anything that is not an email: a source may name a principal
 * with no address (a deleted account, a service identity), and a grant we
 * cannot attribute to a person must be dropped rather than guessed at.
 */
export function userToken(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return null
  const token = `u:${normalized}`
  return isAccessToken(token) ? token : null
}

export interface GroupIdentity {
  providerId: string
  /** The provider's tenant, or {@link NO_TENANT_SEGMENT} where it reports none. */
  tenantId: string | null
  /**
   * The group in whichever identifier both the crawl and the directory sync
   * can see — a group email on Drive, a group id on Confluence. Whatever the
   * source's permissions API returns is what the directory is keyed by, so no
   * lookup ever stands between a grant and the membership that resolves it.
   */
  groupId: string
}

/**
 * A group identifier in the one form every writer and reader agrees on.
 *
 * Both the crawl that writes a `g:` token and the directory sync that stores
 * the group's membership pass through this, so the two can never disagree about
 * case or whitespace — Drive spells a group email however it was typed, and a
 * grant that folds differently from its membership row grants nobody.
 */
export function canonicalGroupId(groupId: string): string {
  return groupId.trim().toLowerCase()
}

/** The token of a group grant. */
export function groupToken(group: GroupIdentity): string | null {
  const { providerId } = group
  const tenant = group.tenantId || NO_TENANT_SEGMENT
  const groupId = canonicalGroupId(group.groupId ?? '')
  if (!providerId || !groupId) return null
  if (providerId.includes(':') || tenant.includes(':')) return null
  const token = `g:${providerId}:${tenant}:${groupId}`
  return isAccessToken(token) ? token : null
}

/**
 * Canonical ordering for every ACL and token set: code-unit order, never
 * locale-aware, so two writers produce byte-identical arrays and Postgres array
 * comparison stays meaningful.
 */
export function sortAccessTokens(tokens: Iterable<string>): string[] {
  const unique = [...new Set(tokens)]
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return unique
}
