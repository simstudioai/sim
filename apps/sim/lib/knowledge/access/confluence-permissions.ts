import { groupToken, sortAccessTokens, subjectToken } from '@/lib/knowledge/access/tokens'
import { LINK_ACCESS_TOKEN } from '@/lib/knowledge/access/types'

/** Opaque source identities from space grants and content restrictions. */
export interface ConfluencePrincipal {
  kind: 'user' | 'group'
  id: string
}

/** Atlassian account IDs are global, matching the managed OAuth /me identity. */
export function confluenceSubjectToken(accountId: string): string {
  return subjectToken({
    providerId: 'confluence',
    providerTenantId: null,
    providerSubjectId: accountId,
  })
}

/**
 * A page's own read restriction, or `null` when it has none.
 *
 * `null` is load-bearing and distinct from an empty list: no restriction means
 * "inherit", while a restriction naming nobody means the page is readable by
 * nobody. Collapsing the two would publish every unrestricted page under its
 * space's ACL *and* every deliberately-locked one under nothing.
 */
export type ConfluenceRestriction = ConfluencePrincipal[] | null

export interface ConfluenceAclInput {
  /** Space access is required even when a page explicitly names the reader. */
  spacePrincipals: readonly ConfluencePrincipal[]
  /**
   * The page's own restriction, then its ancestors' from closest parent
   * outward. Every non-null restriction must be satisfied, as well as the space.
   */
  restrictionChain: readonly ConfluenceRestriction[]
  /** The provider segment of every group token, matching the directory sync. */
  providerId: string
  /** The Confluence site — its cloud id, which is unique and never renamed. */
  tenantId: string
}

export interface ConfluenceAclResult {
  acl: string[]
  requirements: string[][]
}

/**
 * The ACL of one Confluence page, blog post, or attachment.
 *
 * Space access and every page/ancestor read restriction are conjunctive. Each
 * clause retains its user/group alternatives, so group membership need not be
 * expanded or token identifiers incorrectly intersected at indexing time.
 */
export function confluencePageAcl(input: ConfluenceAclInput): ConfluenceAclResult {
  const clause = (principals: readonly ConfluencePrincipal[]): string[] => {
    const tokens = new Set<string>()
    for (const principal of principals) {
      if (principal.kind === 'group') {
        const token = groupToken({
          providerId: input.providerId,
          tenantId: input.tenantId,
          groupId: principal.id,
        })
        if (token) tokens.add(token)
        continue
      }

      tokens.add(confluenceSubjectToken(principal.id))
    }
    return sortAccessTokens(tokens)
  }

  const acl = clause(input.spacePrincipals)
  const requirements = input.restrictionChain
    .filter((restriction): restriction is ConfluencePrincipal[] => restriction !== null)
    .map(clause)

  return {
    acl: acl.length === 0 ? [LINK_ACCESS_TOKEN] : acl,
    requirements,
  }
}
