import { memo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@sim/emcn'
import type { ResourceCell } from '@/app/workspace/[workspaceId]/components/resource/resource'
import type { WorkspaceMember } from '@/hooks/queries/workspace'

export interface OwnerAvatarProps {
  name: string
  image: string | null
}

/**
 * The canonical 14px workspace-member avatar — a photo, or the member's initial on a neutral
 * disc. Shared so a member reads identically in a resource row's owner cell and in the
 * owner/uploaded-by filter options on every list.
 */
export const OwnerAvatar = memo(function OwnerAvatar({ name, image }: OwnerAvatarProps) {
  return (
    <Avatar size='xs'>
      {image && <AvatarImage src={image} alt={name} referrerPolicy='no-referrer' />}
      <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
})

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
    icon: <OwnerAvatar name={member.name} image={member.image} />,
    label: member.name,
  }
}
