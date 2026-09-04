import { groupToken, sortAccessTokens, userToken } from '@/lib/knowledge/access/tokens'
import { LINK_ACCESS_TOKEN, PUBLIC_ACCESS_TOKEN } from '@/lib/knowledge/access/types'

/**
 * One entry of a Drive file's `permissions[]`, narrowed to the fields that
 * decide who may read it.
 *
 * @see https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions
 */
export interface DrivePermission {
  type?: string
  emailAddress?: string | null
  domain?: string | null
  /**
   * Whether an `anyone` or `domain` grant makes the file *findable*, as opposed
   * to merely openable by someone already holding its link. Absent means true,
   * which is what the Drive API documents.
   */
  allowFileDiscovery?: boolean | null
  /** Set when the grant descends from a folder or shared drive rather than the file. */
  permittedBy?: string[] | null
}

/**
 * Whether a source's open shares are searchable in Sim. Off by default, and per
 * connector: an admin turns it on knowing their domain's sharing hygiene.
 *
 * Glean's default, reached through Onyx's mechanism. Glean hides a file shared
 * to the whole domain — or to anyone with the link — from search unless an
 * admin opts in, because in a large domain those shares are usually accidental
 * and their contents are exactly what nobody meant to publish.
 */
export interface OpenSharingPolicy {
  /** Grant a `domain` share to everyone in that domain. */
  domain: boolean
  /** Grant a discoverable `anyone` share to everyone. */
  anyone: boolean
}

export const CLOSED_OPEN_SHARING: OpenSharingPolicy = Object.freeze({
  domain: false,
  anyone: false,
})

/**
 * The synthetic group standing for "everyone in this domain".
 *
 * Onyx's `build_domain_group_id`, kept because it makes a domain share an
 * ordinary group grant: one token shape at the read side, and membership
 * decided by the reader's own email domain rather than a second predicate.
 */
export function domainGroupId(domain: string): string {
  return `domain:${domain.trim().toLowerCase()}`
}

export interface DriveAclInput {
  permissions: readonly DrivePermission[]
  /** The provider segment of every group token this file produces. */
  providerId: string
  /** The Google Workspace customer the crawl runs against. */
  tenantId: string | null
  policy: OpenSharingPolicy
  /**
   * The shared drive the file lives on, if any. Recorded as a group rather than
   * expanded here: a shared drive's membership is directory state, and
   * resolving it during the crawl would re-read it once per file.
   */
  driveId?: string | null
}

/**
 * The ACL of one Drive file, from the permissions the listing returned.
 *
 * Inheritance is deliberately not resolved here. A grant that descends from a
 * folder still arrives in `permissions[]` with `permittedBy` naming its source,
 * so it maps like any other; what is *not* resolved is group membership, which
 * belongs to the directory sync. That keeps the crawl one pass over files.
 *
 * A file whose every grant is unrepresentable — an `anyone` share that is
 * link-only, a principal with no email — resolves to a single `link` token
 * rather than an empty array, so "hidden on purpose" stays distinguishable
 * from "hidden because we failed".
 */
export function driveFileAcl(input: DriveAclInput): string[] {
  const { permissions, providerId, tenantId, policy } = input
  const tokens = new Set<string>()

  for (const permission of permissions) {
    switch (permission.type) {
      case 'user': {
        const token = userToken(permission.emailAddress)
        if (token) tokens.add(token)
        break
      }
      case 'group': {
        /**
         * Drive names a group by its email and never returns a group id, and
         * the Directory API lists groups by email too, so the email is the one
         * identifier the writer and the reader can both see without a lookup.
         */
        const token = groupToken({
          providerId,
          tenantId,
          groupId: permission.emailAddress ?? '',
        })
        if (token) tokens.add(token)
        break
      }
      case 'domain': {
        if (!policy.domain || !isDiscoverable(permission) || !permission.domain) break
        const token = groupToken({
          providerId,
          tenantId,
          groupId: domainGroupId(permission.domain),
        })
        if (token) tokens.add(token)
        break
      }
      case 'anyone': {
        /**
         * `allowFileDiscovery: false` is "anyone with the link", which Drive
         * excludes from its own search. Treating it as public — as Onyx's file
         * path does, though its folder path checks the flag — publishes every
         * document anyone ever pasted a link to.
         */
        if (policy.anyone && isDiscoverable(permission)) tokens.add(PUBLIC_ACCESS_TOKEN)
        break
      }
      default:
        break
    }
  }

  if (input.driveId) {
    const token = groupToken({ providerId, tenantId, groupId: input.driveId })
    if (token) tokens.add(token)
  }

  if (tokens.size === 0) return [LINK_ACCESS_TOKEN]
  return sortAccessTokens(tokens)
}

/** Drive omits `allowFileDiscovery` when the grant is discoverable. */
function isDiscoverable(permission: DrivePermission): boolean {
  return permission.allowFileDiscovery !== false
}
