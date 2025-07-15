import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks/registry'

interface TemplateCardProps {
  id: string
  title: string
  description: string
  author: string
  usageCount: string
  icon?: React.ReactNode
  iconColor?: string
  blocks?: string[]
  onClick?: () => void
  className?: string
  // Add state prop to extract block types
  state?: {
    blocks?: Record<string, { type: string; name?: string }>
  }
}

// Skeleton component for loading states
export function TemplateCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[14px] border bg-card shadow-xs', 'flex h-40', className)}>
      {/* Left side - Info skeleton */}
      <div className='flex min-w-0 flex-1 flex-col justify-between p-4'>
        {/* Top section skeleton */}
        <div className='space-y-3'>
          <div className='flex min-w-0 items-center gap-2.5'>
            {/* Icon skeleton */}
            <div className='h-5 w-5 flex-shrink-0 animate-pulse rounded bg-gray-200' />
            {/* Title skeleton */}
            <div className='h-4 w-24 animate-pulse rounded bg-gray-200' />
          </div>

          {/* Description skeleton */}
          <div className='space-y-2'>
            <div className='h-3 w-full animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-3/4 animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-1/2 animate-pulse rounded bg-gray-200' />
          </div>
        </div>

        {/* Bottom section skeleton */}
        <div className='flex min-w-0 items-center gap-1.5'>
          <div className='h-3 w-8 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-16 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-1 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-3 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-8 animate-pulse rounded bg-gray-200' />
        </div>
      </div>

      {/* Right side - Blocks skeleton */}
      <div className='flex w-20 flex-col gap-1 rounded-r-[14px] bg-secondary p-2'>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className='flex items-center gap-1.5'>
            <div className='h-3 w-3 animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-12 animate-pulse rounded bg-gray-200' />
          </div>
        ))}
      </div>
    </div>
  )
}

// Utility function to extract block types from workflow state
const extractBlockTypesFromState = (state?: {
  blocks?: Record<string, { type: string; name?: string }>
}): string[] => {
  if (!state?.blocks) return []

  // Get unique block types from the state
  const blockTypes = Object.values(state.blocks).map((block) => block.type)
  return [...new Set(blockTypes)]
}

// Utility function to get block icon component from block type
const getBlockIcon = (blockType: string): React.ReactNode => {
  const block = getBlock(blockType)
  if (!block?.icon) return null

  const IconComponent = block.icon
  return <IconComponent className='h-3 w-3' />
}

// Utility function to get block display name
const getBlockDisplayName = (blockType: string): string => {
  const block = getBlock(blockType)
  return block?.name || blockType
}

export function TemplateCard({
  id,
  title,
  description,
  author,
  usageCount,
  icon,
  iconColor = 'bg-blue-500',
  blocks = [],
  onClick,
  className,
  state,
}: TemplateCardProps) {
  // Extract block types from state if provided, otherwise use the blocks prop
  const blockTypes = state ? extractBlockTypesFromState(state) : blocks

  return (
    <div
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-[14px] border bg-card shadow-xs transition-all duration-200 hover:border-border/80 hover:shadow-sm',
        'flex h-40',
        className
      )}
    >
      {/* Left side - Info */}
      <div className='flex min-w-0 flex-1 flex-col justify-between p-4'>
        {/* Top section */}
        <div className='space-y-3'>
          <div className='flex min-w-0 items-center gap-2.5'>
            {/* Icon container */}
            <div
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded',
                iconColor
              )}
            >
              {icon && <div className='h-3 w-3 text-white [&>svg]:h-3 [&>svg]:w-3'>{icon}</div>}
            </div>
            {/* Template name */}
            <h3 className='truncate font-medium font-sans text-card-foreground text-sm leading-tight'>
              {title}
            </h3>
          </div>

          {/* Description */}
          <p className='line-clamp-3 break-words font-sans text-muted-foreground text-xs leading-relaxed'>
            {description}
          </p>
        </div>

        {/* Bottom section */}
        <div className='flex min-w-0 items-center gap-1.5 font-sans text-muted-foreground text-xs'>
          <span className='flex-shrink-0 truncate'>by</span>
          <span className='truncate'>{author}</span>
          <span className='flex-shrink-0'>•</span>
          <User className='h-3 w-3 flex-shrink-0' />
          <span className='truncate'>{usageCount}</span>
        </div>
      </div>

      {/* Right side - Block Icons */}
      <div className='flex w-20 flex-col gap-1 rounded-r-[14px] bg-secondary p-2'>
        {blockTypes.slice(0, 4).map((blockType, index) => (
          <div key={index} className='flex items-center gap-1.5'>
            {/* Block icon */}
            <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
              {getBlockIcon(blockType)}
            </div>
            {/* Block name */}
            <span className='truncate font-sans text-muted-foreground text-xs'>
              {getBlockDisplayName(blockType)}
            </span>
          </div>
        ))}
        {blockTypes.length > 4 && (
          <div className='font-sans text-muted-foreground text-xs'>+{blockTypes.length - 4}</div>
        )}
      </div>
    </div>
  )
}
