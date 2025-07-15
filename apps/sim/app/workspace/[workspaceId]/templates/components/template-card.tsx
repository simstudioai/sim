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
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks/registry'

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
  usageCount: string
  stars?: number
  icon?: React.ReactNode | string
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

  // Get unique block types from the state, excluding starter blocks
  const blockTypes = Object.values(state.blocks)
    .map((block) => block.type)
    .filter((type) => type !== 'starter')
  return [...new Set(blockTypes)]
}

// Utility function to get icon component from string or return the component directly
const getIconComponent = (icon: React.ReactNode | string | undefined): React.ReactNode => {
  if (typeof icon === 'string') {
    const IconComponent = iconMap[icon as keyof typeof iconMap]
    return IconComponent ? <IconComponent /> : <FileText />
  }
  if (icon) {
    return icon
  }
  // Default fallback icon
  return <FileText />
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
  usageCount,
  stars = 0,
  icon,
  iconColor = 'bg-blue-500',
  blocks = [],
  onClick,
  className,
  state,
}: TemplateCardProps) {
  // Extract block types from state if provided, otherwise use the blocks prop
  // Filter out starter blocks in both cases
  const blockTypes = state
    ? extractBlockTypesFromState(state)
    : blocks.filter((blockType) => blockType !== 'starter')

  // Get the icon component
  const iconComponent = getIconComponent(icon)

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
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md',
                // Use CSS class if iconColor doesn't start with #
                iconColor?.startsWith('#') ? '' : iconColor || 'bg-blue-500'
              )}
              style={{
                // Use inline style for hex colors
                backgroundColor: iconColor?.startsWith('#') ? iconColor : undefined,
              }}
            >
              <div className='h-3 w-3 text-white [&>svg]:h-3 [&>svg]:w-3'>{iconComponent}</div>
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
          <span className='flex-shrink-0'>•</span>
          <Star className='h-3 w-3 flex-shrink-0' />
          <span className='truncate'>{stars}</span>
        </div>
      </div>

      {/* Right side - Block Icons */}
      <div className='flex w-14 flex-col items-center justify-center gap-2 rounded-r-[14px] bg-secondary p-2'>
        {blockTypes.slice(0, 3).map((blockType, index) => {
          const blockConfig = getBlockConfig(blockType)
          if (!blockConfig) return null

          return (
            <div key={index} className='flex items-center justify-center'>
              <div
                className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded'
                style={{ backgroundColor: blockConfig.bgColor || 'gray' }}
              >
                <blockConfig.icon className='h-4 w-4 text-white' />
              </div>
            </div>
          )
        })}
        {blockTypes.length > 3 && (
          <div className='flex items-center justify-center'>
            <div className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-gray-400'>
              <span className='font-medium text-white text-xs'>+{blockTypes.length - 3}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
