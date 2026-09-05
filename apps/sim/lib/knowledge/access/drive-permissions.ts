import { domainGroupId } from '@/lib/knowledge/access/external-groups'
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
  /** Whether the account behind a `user` grant has been deleted. */
  deleted?: boolean | null
}

/**
 * Whether a source's open shares are searchable in Sim. Off by default, and per
 * connector: an admin turns it on knowing their domain's sharing hygiene.
 */
export interface OpenSharingPolicy {
  /** Grant a `domain` share to everyone in that domain. */
  domain: boolean
  /** Grant a discoverable `anyone` share to everyone. */
  anyone: boolean
}

export interface DriveAclInput {
  permissions: readonly DrivePermission[]
  /** The provider segment of every group token this file produces. */
  providerId: string
  /** The Google Workspace customer the crawl runs against. */
  tenantId: string | null
  policy: OpenSharingPolicy
}

/**
 * The ACL of one Drive file, from the permissions the listing returned.
 *
 * Inheritance needs no resolving here. A grant that descends from a folder or
 * from shared-drive membership arrives in `permissions[]` as an ordinary
 * principal, so it maps like any other; what is *not* resolved is group
 * membership, which belongs to the directory sync. That keeps the crawl one
 * pass over files.
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
    /**
     * A deleted account's grant is a grant to nobody — and to whoever is later
     * provisioned with the recycled address, if it were minted.
     */
    if (permission.deleted) continue
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
         * excludes from its own search.
         */
        if (policy.anyone && isDiscoverable(permission)) tokens.add(PUBLIC_ACCESS_TOKEN)
        break
      }
      default:
        break
    }
  }

  if (tokens.size === 0) return [LINK_ACCESS_TOKEN]
  return sortAccessTokens(tokens)
}

/** Drive omits `allowFileDiscovery` when the grant is discoverable. */
function isDiscoverable(permission: DrivePermission): boolean {
  return permission.allowFileDiscovery !== false
}
