import { Avatar, AvatarFallback, AvatarImage } from '@sim/emcn'
import { getUserColor } from '@/lib/workspaces/colors'

interface UsageMemberAvatarProps {
  id: string
  name: string
  image?: string | null
}

/** A 20px member mark for ranked usage rows, sized to sit on a line with a provider glyph. */
export function UsageMemberAvatar({ id, name, image }: UsageMemberAvatarProps) {
  return (
    <Avatar className='size-5'>
      {image && <AvatarImage src={image} alt='' />}
      <AvatarFallback
        style={{ background: getUserColor(id) }}
        className='border-0 text-micro text-white'
        aria-hidden='true'
      >
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
