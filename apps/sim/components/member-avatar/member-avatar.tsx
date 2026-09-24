import { memo } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@sim/emcn'

interface MemberAvatarProps {
  name: string
  image: string | null
}

/**
 * A person's avatar in a list: their photo, or their initial on the neutral disc. 14px,
 * so it sits on a line with the 14px icons around it. Built on emcn `Avatar`, so a photo
 * that fails to load falls back to the initial rather than rendering a broken image.
 * Hidden from assistive tech: the person's name is always beside it.
 */
export const MemberAvatar = memo(function MemberAvatar({ name, image }: MemberAvatarProps) {
  return (
    <Avatar size='xs' aria-hidden>
      {image && <AvatarImage src={image} alt='' referrerPolicy='no-referrer' />}
      <AvatarFallback className='text-[8px] leading-none'>
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
})
