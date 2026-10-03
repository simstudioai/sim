import { Avatar } from '@sim/emcn'
import type { ResourceCell } from '@/app/workspace/[workspaceId]/components/resource/resource'
import type { WorkspaceMember } from '@/hooks/queries/workspace'

/**
 * Resolves a user ID into a ResourceCell with an avatar icon and display name.
 * Returns null label while members are still loading to avoid flashing raw IDs.
 *
 * Accepts either the raw member array or a precomputed `userId → member` map.
 * Prefer the map form when resolving many rows so lookups stay O(1) instead of
 * scanning the array per row.
 */
export function ownerCell(
  userId: string | null | undefined,
  members?: WorkspaceMember[] | Map<string, WorkspaceMember>
): ResourceCell {
  if (!userId) return { label: null }
  if (!members) return { label: null }

  const member =
    members instanceof Map ? members.get(userId) : members.find((m) => m.userId === userId)
  if (!member) return { label: null }

  return {
    icon: <Avatar size='xs' name={member.name} src={member.image} aria-hidden />,
    label: member.name,
  }
}
