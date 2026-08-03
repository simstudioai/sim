import { Avatar, AvatarFallback, AvatarImage } from '@sim/emcn'
import { getUserColor } from '@/lib/workspaces/colors'

interface MemberAvatarProps {
  name: string
  image?: string | null
  /** Seed for the generated fallback background; defaults to the name. */
  colorSeed?: string
}

/**
 * The one avatar worn by every member row — Teammates, Organization, and the
 * credential Members sections. Matches `RESOURCE_TILE_BASE`'s 36px footprint so
 * a member row keeps the same rhythm as a resource row.
 */
export function MemberAvatar({ name, image, colorSeed }: MemberAvatarProps) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <Avatar className='size-9 flex-shrink-0'>
      {image ? <AvatarImage src={image} alt={name} referrerPolicy='no-referrer' /> : null}
      <AvatarFallback
        style={{ background: getUserColor(colorSeed || name || '') }}
        className='border border-[var(--border-1)] text-small text-white'
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  )
}
