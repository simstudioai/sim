'use client'

import type { ResourceCell } from '@/app/workspace/[workspaceId]/components/resource/resource'
import type { WorkspaceMember } from '@/hooks/queries/workspace'

function OwnerAvatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        referrerPolicy='no-referrer'
        className='h-[14px] w-[14px] rounded-full border border-[var(--border)] object-cover'
      />
    )
  }

  return (
    <span className='flex h-[14px] w-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Resolves a user ID into a ResourceCell with an avatar icon and display name.
 * Returns null label while members are still loading to avoid flashing raw IDs.
 */
export function ownerCell(
  userId: string | null | undefined,
  members?: WorkspaceMember[]
): ResourceCell {
  if (!userId) return { label: null }
  if (!members) return { label: null }

  const member = members.find((m) => m.userId === userId)
  if (!member) return { label: null }

  return {
    icon: <OwnerAvatar name={member.name} image={member.image} />,
    label: member.name,
  }
}
