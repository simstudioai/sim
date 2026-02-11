import React from 'react'
import {
  SubBlockRow,
  type SubBlockRowProps,
} from '@/app/(landing)/components/hero/components/landing-canvas/landing-block/tag'

/**
 * Data structure for a landing card component
 * Matches the workflow block structure from the application
 */
export interface LandingCardData {
  /** Icon element to display in the card header */
  icon: React.ReactNode
  /** Background color for the icon container */
  color: string | '#f6f6f6'
  /** Name/title of the card */
  name: string
  /** Optional subblock rows to display below the header */
  tags?: SubBlockRowProps[]
}

/**
 * Props for the LandingBlock component
 */
export interface LandingBlockProps extends LandingCardData {
  /** Optional CSS class names */
  className?: string
}

/**
 * Landing block component that displays a card with icon, name, and optional subblock rows
 * Styled to match the application's workflow blocks
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
  const hasContentBelowHeader = tags && tags.length > 0

  return (
    <div
      className={`z-10 flex w-[250px] flex-col rounded-[8px] border border-[#E5E5E5] bg-white ${className ?? ''}`}
    >
      {/* Header - matches workflow-block.tsx header styling */}
      <div
        className={`flex items-center justify-between p-[8px] ${hasContentBelowHeader ? 'border-[#E5E5E5] border-b' : ''}`}
      >
        <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
          <div
            className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
            style={{ background: color as string }}
          >
            {icon}
          </div>
          <span className='truncate font-medium text-[#171717] text-[16px]' title={name}>
            {name}
          </span>
        </div>
      </div>

      {/* Content - SubBlock Rows matching workflow-block.tsx */}
      {hasContentBelowHeader && (
        <div className='flex flex-col gap-[8px] p-[8px]'>
          {tags.map((tag) => (
            <SubBlockRow key={tag.label} icon={tag.icon} label={tag.label} />
          ))}
        </div>
      )}
    </div>
  )
})
