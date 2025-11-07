import { useState } from 'react'
import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Calculator,
  Cloud,
  Code,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Edit,
  FileText,
  Folder,
  Globe,
  HeadphonesIcon,
  Layers,
  Lightbulb,
  LineChart,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Phone,
  Play,
  Search,
  Server,
  Settings,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  User,
  Users,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('TemplateCard')

// Icon mapping for template icons
const iconMap = {
  // Content & Documentation
  FileText,
  NotebookPen,
  BookOpen,
  Edit,

  // Analytics & Charts
  BarChart3,
  LineChart,
  TrendingUp,
  Target,

  // Database & Storage
  Database,
  Server,
  Cloud,
  Folder,

  // Marketing & Communication
  Megaphone,
  Mail,
  MessageSquare,
  Phone,
  Bell,

  // Sales & Finance
  DollarSign,
  CreditCard,
  Calculator,
  ShoppingCart,
  Briefcase,

  // Support & Service
  HeadphonesIcon,
  User,
  Users,
  Settings,
  Wrench,

  // AI & Technology
  Bot,
  Brain,
  Cpu,
  Code,
  Zap,

  // Workflow & Process
  Workflow,
  Search,
  Play,
  Layers,

  // General
  Lightbulb,
  Star,
  Globe,
  Award,
}

interface TemplateCardProps {
  id: string
  title: string
  description: string
  author: string
  userId: string
  authorType: 'user' | 'organization'
  organizationId: string | null
  usageCount: string
  stars?: number
  blocks?: string[]
  tags?: string[]
  onClick?: () => void
  className?: string
  // Add state prop to extract block types
  state?: {
    blocks?: Record<string, { type: string; name?: string }>
  }
  isStarred?: boolean
  // Optional callback when template is successfully used (for closing modals, etc.)
  onTemplateUsed?: () => void
  // Callback when star state changes (for parent state updates)
  onStarChange?: (templateId: string, isStarred: boolean, newStarCount: number) => void
  // User authentication status
  isAuthenticated?: boolean
}

// Skeleton component for loading states
export function TemplateCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[8px] border bg-card shadow-xs', 'flex h-[142px]', className)}>
      {/* Left side - Info skeleton */}
      <div className='flex min-w-0 flex-1 flex-col justify-between p-4'>
        {/* Top section skeleton */}
        <div className='space-y-2'>
          <div className='flex min-w-0 items-center justify-between gap-2.5'>
            <div className='flex min-w-0 items-center gap-2.5'>
              {/* Icon skeleton */}
              <div className='h-5 w-5 flex-shrink-0 animate-pulse rounded-md bg-gray-200' />
              {/* Title skeleton */}
              <div className='h-4 w-32 animate-pulse rounded bg-gray-200' />
            </div>

            {/* Star and Use button skeleton */}
            <div className='flex flex-shrink-0 items-center gap-3'>
              <div className='h-4 w-4 animate-pulse rounded bg-gray-200' />
              <div className='h-6 w-10 animate-pulse rounded-md bg-gray-200' />
            </div>
          </div>

          {/* Description skeleton */}
          <div className='space-y-1.5'>
            <div className='h-3 w-full animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-4/5 animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-3/5 animate-pulse rounded bg-gray-200' />
          </div>
        </div>

        {/* Bottom section skeleton */}
        <div className='flex min-w-0 items-center gap-1.5 pt-1.5'>
          <div className='h-3 w-6 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-16 animate-pulse rounded bg-gray-200' />
          <div className='h-2 w-1 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-3 animate-pulse rounded bg-gray-200' />
          <div className='h-3 w-8 animate-pulse rounded bg-gray-200' />
          {/* Stars section - hidden on smaller screens */}
          <div className='hidden flex-shrink-0 items-center gap-1.5 sm:flex'>
            <div className='h-2 w-1 animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-3 animate-pulse rounded bg-gray-200' />
            <div className='h-3 w-6 animate-pulse rounded bg-gray-200' />
          </div>
        </div>
      </div>

      {/* Right side - Block Icons skeleton */}
      <div className='flex w-16 flex-col items-center justify-center gap-2 rounded-r-[8px] border-border border-l bg-secondary p-2'>
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className='animate-pulse rounded bg-gray-200'
            style={{ width: '30px', height: '30px' }}
          />
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

  // Get unique block types from the state, excluding starter blocks
  // Sort the keys to ensure consistent ordering between server and client
  const blockTypes = Object.keys(state.blocks)
    .sort() // Sort keys to ensure consistent order
    .map((key) => state.blocks![key].type)
    .filter((type) => type !== 'starter')
  return [...new Set(blockTypes)]
}

// Utility function to get block display name
const getBlockDisplayName = (blockType: string): string => {
  const block = getBlock(blockType)
  return block?.name || blockType
}

// Utility function to get the full block config for colored icon display
const getBlockConfig = (blockType: string) => {
  const block = getBlock(blockType)
  return block
}

export function TemplateCard({
  id,
  title,
  description,
  author,
  userId,
  authorType,
  organizationId,
  usageCount,
  stars = 0,
  blocks = [],
  tags = [],
  onClick,
  className,
  state,
  isStarred = false,
  onTemplateUsed,
  onStarChange,
  isAuthenticated = true,
}: TemplateCardProps) {
  const router = useRouter()
  const params = useParams()

  // Local state for optimistic updates
  const [localIsStarred, setLocalIsStarred] = useState(isStarred)
  const [localStarCount, setLocalStarCount] = useState(stars)
  const [isStarLoading, setIsStarLoading] = useState(false)

  // Extract block types from state if provided, otherwise use the blocks prop
  // Filter out starter blocks in both cases and sort for consistent rendering
  const blockTypes = state
    ? extractBlockTypesFromState(state)
    : blocks.filter((blockType) => blockType !== 'starter').sort()

  // Handle star toggle with optimistic updates
  const handleStarClick = async (e: React.MouseEvent) => {
    e.stopPropagation()

    // Prevent multiple clicks while loading
    if (isStarLoading) return

    setIsStarLoading(true)

    // Optimistic update - update UI immediately
    const newIsStarred = !localIsStarred
    const newStarCount = newIsStarred ? localStarCount + 1 : localStarCount - 1

    setLocalIsStarred(newIsStarred)
    setLocalStarCount(newStarCount)

    // Notify parent component immediately for optimistic update
    if (onStarChange) {
      onStarChange(id, newIsStarred, newStarCount)
    }

    try {
      const method = localIsStarred ? 'DELETE' : 'POST'
      const response = await fetch(`/api/templates/${id}/star`, { method })

      if (!response.ok) {
        // Rollback on error
        setLocalIsStarred(localIsStarred)
        setLocalStarCount(localStarCount)

        // Rollback parent state too
        if (onStarChange) {
          onStarChange(id, localIsStarred, localStarCount)
        }

        logger.error('Failed to toggle star:', response.statusText)
      }
    } catch (error) {
      // Rollback on error
      setLocalIsStarred(localIsStarred)
      setLocalStarCount(localStarCount)

      // Rollback parent state too
      if (onStarChange) {
        onStarChange(id, localIsStarred, localStarCount)
      }

      logger.error('Error toggling star:', error)
    } finally {
      setIsStarLoading(false)
    }
  }

  // Handle use click - just navigate to detail page
  const handleUseClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`/templates/${id}`)
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on action buttons
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[data-action]')) {
      return
    }

    router.push(`/templates/${id}`)
  }

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'group cursor-pointer rounded-[8px] border bg-card shadow-xs transition-shadow duration-200 hover:border-border/80 hover:shadow-sm',
        'flex h-[142px]',
        className
      )}
    >
      {/* Left side - Info */}
      <div className='flex min-w-0 flex-1 flex-col justify-between p-4'>
        {/* Top section */}
        <div className='space-y-2'>
          <div className='flex min-w-0 items-center justify-between gap-2.5'>
            <div className='flex min-w-0 items-center gap-2.5'>
              {/* Template name */}
              <h3 className='truncate font-medium font-sans text-card-foreground text-sm leading-tight'>
                {title}
              </h3>
            </div>

            {/* Actions */}
            <div className='flex flex-shrink-0 items-center gap-2'>
              {/* Star button - only for authenticated users */}
              {isAuthenticated && (
                <Star
                  onClick={handleStarClick}
                  className={cn(
                    'h-4 w-4 cursor-pointer transition-colors duration-50',
                    localIsStarred
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-muted-foreground hover:fill-yellow-400 hover:text-yellow-400',
                    isStarLoading && 'opacity-50'
                  )}
                />
              )}
              <button
                onClick={handleUseClick}
                className={cn(
                  'rounded-[8px] px-3 py-1 font-medium font-sans text-white text-xs transition-[background-color,box-shadow] duration-200',
                  'bg-[var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)]',
                  'shadow-[0_0_0_0_var(--brand-primary-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                )}
              >
                Use
              </button>
            </div>
          </div>

          {/* Description */}
          <p className='line-clamp-2 break-words font-sans text-muted-foreground text-xs leading-relaxed'>
            {description}
          </p>

          {/* Tags */}
          {tags && tags.length > 0 && (
            <div className='flex flex-wrap gap-1 mt-1'>
              {tags.slice(0, 3).map((tag, index) => (
                <Badge
                  key={index}
                  variant='secondary'
                  className='h-5 px-1.5 text-[10px] bg-muted/60 hover:bg-muted/80 border-0'
                >
                  {tag}
                </Badge>
              ))}
              {tags.length > 3 && (
                <Badge
                  variant='secondary'
                  className='h-5 px-1.5 text-[10px] bg-muted/60 hover:bg-muted/80 border-0'
                >
                  +{tags.length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className='flex min-w-0 items-center gap-1.5 pt-1.5 font-sans text-muted-foreground text-xs'>
          <span className='flex-shrink-0'>by</span>
          <span className='min-w-0 truncate'>{author}</span>
          <span className='flex-shrink-0'>•</span>
          <User className='h-3 w-3 flex-shrink-0' />
          <span className='flex-shrink-0'>{usageCount}</span>
          {/* Stars section - hidden on smaller screens when space is constrained */}
          <div className='hidden flex-shrink-0 items-center gap-1.5 sm:flex'>
            <span>•</span>
            <Star className='h-3 w-3' />
            <span>{localStarCount}</span>
          </div>
        </div>
      </div>

      {/* Right side - Block Icons */}
      <div className='flex w-16 flex-col items-center justify-center gap-2 rounded-r-[8px] border-border border-l bg-secondary p-2'>
        {blockTypes.length > 3 ? (
          <>
            {/* Show first 2 blocks when there are more than 3 */}
            {blockTypes.slice(0, 2).map((blockType, index) => {
              const blockConfig = getBlockConfig(blockType)
              if (!blockConfig) return null

              return (
                <div key={index} className='flex items-center justify-center'>
                  <div
                    className='flex flex-shrink-0 items-center justify-center rounded-[8px]'
                    style={{
                      backgroundColor: blockConfig.bgColor || 'gray',
                      width: '30px',
                      height: '30px',
                    }}
                  >
                    <blockConfig.icon className='h-4 w-4 text-white' />
                  </div>
                </div>
              )
            })}
            {/* Show +n block for remaining blocks */}
            <div className='flex items-center justify-center'>
              <div
                className='flex flex-shrink-0 items-center justify-center rounded-[8px] bg-muted-foreground'
                style={{ width: '30px', height: '30px' }}
              >
                <span className='font-medium text-white text-xs'>+{blockTypes.length - 2}</span>
              </div>
            </div>
          </>
        ) : (
          /* Show all blocks when 3 or fewer */
          blockTypes.map((blockType, index) => {
            const blockConfig = getBlockConfig(blockType)
            if (!blockConfig) return null

            return (
              <div key={index} className='flex items-center justify-center'>
                <div
                  className='flex flex-shrink-0 items-center justify-center rounded-[8px]'
                  style={{
                    backgroundColor: blockConfig.bgColor || 'gray',
                    width: '30px',
                    height: '30px',
                  }}
                >
                  <blockConfig.icon className='h-4 w-4 text-white' />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
