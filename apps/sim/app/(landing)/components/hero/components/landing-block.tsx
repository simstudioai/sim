import React from 'react'
import { BookIcon } from 'lucide-react'
import { Tag, type TagProps } from './tag'

/**
 * Data structure for a landing card component
 */
export interface LandingCardData {
  /** Icon element to display in the card header */
  icon: React.ReactNode
  /** Background color for the icon container */
  color: string | '#f6f6f6'
  /** Name/title of the card */
  name: string
  /** Optional tags to display at the bottom of the card */
  tags?: TagProps[]
}

/**
 * Props for the LandingBlock component
 */
export interface LandingBlockProps extends LandingCardData {
  /** Optional CSS class names */
  className?: string
}

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
      className={`z-10 flex w-64 flex-col items-start gap-3 rounded-[14px] border border-[#E5E5E5] bg-[#FEFEFE] p-3 ${className ?? ''}`}
      style={{
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      }}
    >
      <div className='flex w-full items-center justify-between'>
        <div className='flex items-center gap-2.5'>
          <div
            className='flex h-6 w-6 items-center justify-center rounded-[8px] text-white'
            style={{ backgroundColor: color as string }}
          >
            {icon}
          </div>
          <p className='text-base text-card-foreground'>{name}</p>
        </div>
        <BookIcon className='h-4 w-4 text-muted-foreground' />
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
