import { PUBLIC_ACCESS_TOKEN, WORKSPACE_ACCESS_TOKEN } from '@/lib/knowledge/access/types'

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
 * Canonical ordering for every ACL and token set: code-unit order, never
 * locale-aware, so two writers produce byte-identical arrays and Postgres array
 * comparison stays meaningful.
 */
export function sortAccessTokens(tokens: Iterable<string>): string[] {
  const unique = [...new Set(tokens)]
  unique.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return unique
}

/**
 * The ACL of a members-mode document: the sorted subject tokens of its active
 * observers. Rejects anything that is not a well-formed token so a malformed
 * value fails here rather than denying access silently.
 */
export function buildAclFromObservers(tokens: Iterable<string>): string[] {
  const sorted = sortAccessTokens(tokens)
  for (const token of sorted) {
    if (!isAccessToken(token)) throw new Error(`Access token is malformed: ${token}`)
  }
  return sorted
}

/** Whether a scope's token set grants nothing beyond what every workspace member holds. */
export function isWorkspaceOnlyTokenSet(tokens: readonly string[]): boolean {
  return tokens.every((token) => token === WORKSPACE_ACCESS_TOKEN || token === PUBLIC_ACCESS_TOKEN)
}
