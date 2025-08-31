import React from 'react'
import { BookIcon, ChevronUpIcon } from 'lucide-react'
import { Tag } from './tag'
import type { LandingBlockProps } from './types'

/**
 * Landing block component that displays a card with icon, name, and optional tags
 * @param props - Component properties including icon, color, name, tags, and className
 * @returns A styled block card component
 */
export const LandingBlock = React.memo(function LandingBlock({
  icon,
  color,
  name,
  tags,
  className,
}: LandingBlockProps) {
  return (
    <div
      className={`z-10 flex h-fit w-64 flex-col gap-4 rounded-[14px] border border-border bg-card p-3 shadow-xs ${className ?? ''}`}
    >
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2.5'>
          <div
            className='flex h-6 w-6 items-center justify-center rounded-[8px] text-white'
            style={{ backgroundColor: color as string }}
          >
            {icon}
          </div>
          <p className='font-medium text-base text-card-foreground'>{name}</p>
        </div>
        <div className='flex items-center gap-4'>
          <BookIcon className='h-4 w-4 text-muted-foreground' />
          <ChevronUpIcon className='h-4 w-4 text-muted-foreground' />
        </div>
      </div>

      {tags && tags.length > 0 ? (
        <div className='flex flex-wrap gap-2'>
          {tags.map((tag) => (
            <Tag key={tag.label} icon={tag.icon} label={tag.label} />
          ))}
        </div>
      ) : null}
    </div>
  )
})
