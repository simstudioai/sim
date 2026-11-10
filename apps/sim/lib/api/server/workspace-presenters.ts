import type { V2WorkspaceMember } from '@/lib/api/contracts/v2/workspaces'
import type { WorkspaceMemberRow } from '@/lib/workspaces/public-queries'

/** One effective member as every v2 member response renders them. */
export function presentWorkspaceMember(member: WorkspaceMemberRow): V2WorkspaceMember {
  return {
    userId: member.userId,
    email: member.email,
    name: member.name,
    image: member.image,
    role: member.role,
    isExternal: member.isExternal,
    joinedAt: member.joinedAt.toISOString(),
  }
}
