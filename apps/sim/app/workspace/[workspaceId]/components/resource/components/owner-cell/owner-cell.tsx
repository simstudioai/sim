import { memo } from 'react'
import type { ResourceCell } from '@/app/workspace/[workspaceId]/components/resource/resource'
import type { WorkspaceMember } from '@/hooks/queries/workspace'

interface OwnerAvatarProps {
  name: string
  image: string | null
}

const OwnerAvatar = memo(function OwnerAvatar({ name, image }: OwnerAvatarProps) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        referrerPolicy='no-referrer'
        className='size-[14px] rounded-full border border-[var(--border)] object-cover'
      />
    )
  }

  return (
    <span className='flex size-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
      {name.charAt(0).toUpperCase()}
    </span>
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
