import { groupToken, sortAccessTokens, userToken } from '@/lib/knowledge/access/tokens'
import { LINK_ACCESS_TOKEN } from '@/lib/knowledge/access/types'

/**
 * A principal Confluence names on a space permission or a page restriction.
 *
 * Confluence identifies both kinds by opaque id — an Atlassian account id for a
 * person, a group id for a group — never by email or name. A person's email is
 * resolved separately and may be withheld entirely; a group's id needs no
 * resolution at all.
 */
export interface ConfluencePrincipal {
  kind: 'user' | 'group'
  id: string
  /**
   * The person's address, where Confluence disclosed it. Absent for a group,
   * and absent for a person whose profile hides it.
   */
  email?: string | null
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
  /** Who may read the space, from its permissions. The fallback for every page in it. */
  spacePrincipals: readonly ConfluencePrincipal[]
  /**
   * The page's own restriction, then its ancestors' from closest parent
   * outward. The first entry that is not `null` decides; if none is, the space
   * decides.
   */
  restrictionChain: readonly ConfluenceRestriction[]
  /** The provider segment of every group token, matching the directory sync. */
  providerId: string
  /** The Confluence site — its cloud id, which is unique and never renamed. */
  tenantId: string
}

export interface ConfluenceAclResult {
  acl: string[]
  /**
   * People named on the winning grant whose email Confluence withheld, so the
   * grant could not be attributed. Reported rather than silently dropped: on a
   * site that hides every profile it is the difference between "this page is
   * restricted to two people" and "this page is readable by nobody".
   */
  unattributedUsers: number
}

/**
 * The ACL of one Confluence page, blog post, or attachment.
 *
 * A read restriction **replaces** the space's permissions rather than narrowing
 * them, which is Onyx's rule and the one Confluence's own UI leads people to
 * expect. Real Confluence access is the intersection — space permission *and*
 * restriction — so this over-grants in exactly one case: somebody named on a
 * page restriction who cannot view the space at all. That is a misconfiguration
 * in the source, and it errs toward a page they were deliberately named on.
 *
 * Representing the true intersection would mean expanding both principal sets
 * to member addresses and intersecting them, which our group tables could do
 * and Onyx's cannot — but it emits one token per member, so a five-thousand
 * person space would carry five-thousand-token ACLs on every restricted page.
 * The union keeps ACLs short, which is what keeps the read predicate fast.
 */
export function confluencePageAcl(input: ConfluenceAclInput): ConfluenceAclResult {
  const winning = input.restrictionChain.find((entry) => entry !== null) ?? input.spacePrincipals

  const tokens = new Set<string>()
  let unattributedUsers = 0
  for (const principal of winning) {
    if (principal.kind === 'group') {
      /**
       * The group's id, not its name. Onyx uses names because its membership
       * sync is keyed by name; ours is keyed by whatever the permissions API
       * returns, and that is the id — so using it costs no extra lookup per
       * group and survives a rename, which a name-keyed ACL would not.
       */
      const token = groupToken({
        providerId: input.providerId,
        tenantId: input.tenantId,
        groupId: principal.id,
      })
      if (token) tokens.add(token)
      continue
    }

    const token = userToken(principal.email)
    if (token) tokens.add(token)
    else unattributedUsers += 1
  }

  return {
    acl: tokens.size === 0 ? [LINK_ACCESS_TOKEN] : sortAccessTokens(tokens),
    unattributedUsers,
  }
}
