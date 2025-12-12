import React from 'react'

/**
 * Properties for a tag component
 */
export interface TagProps {
  /** Icon element to display in the tag */
  icon: React.ReactNode
  /** Text label for the tag */
  label: string
}

/**
 * Tag component for displaying labeled icons in a compact format
 * @param props - Tag properties including icon and label
 * @returns A styled tag component
 */
export const Tag = React.memo(function Tag({ icon, label }: TagProps) {
  return (
    <div className='flex w-fit items-center gap-1 rounded-[8px] border border-gray-300 bg-white px-2 py-0.5'>
      <div className='h-3 w-3 text-muted-foreground'>{icon}</div>
      <p className='text-muted-foreground text-xs leading-normal'>{label}</p>
    </div>
  )
})
