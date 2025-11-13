import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star, User } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateCard')

interface TemplateCardProps {
  id: string
  title: string
  description: string
  author: string
  authorImageUrl?: string | null
  usageCount: string
  stars?: number
  icon?: React.ReactNode | string
  iconColor?: string
  blocks?: string[]
  onClick?: () => void
  className?: string
  // Workflow state for rendering preview
  state?: WorkflowState
  isStarred?: boolean
  // Optional callback when template is successfully used (for closing modals, etc.)
  onTemplateUsed?: () => void
  // Callback when star state changes (for parent state updates)
  onStarChange?: (templateId: string, isStarred: boolean, newStarCount: number) => void
  // User authentication status
  isAuthenticated?: boolean
}

/**
 * Skeleton component for loading states
 */
export function TemplateCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('h-[268px] w-full rounded-[8px] bg-[#202020] p-[8px]', className)}>
      {/* Workflow preview skeleton */}
      <div className='h-[180px] w-full animate-pulse rounded-[6px] bg-gray-700' />

      {/* Title and blocks row skeleton */}
      <div className='mt-[14px] flex items-center justify-between'>
        <div className='h-4 w-32 animate-pulse rounded bg-gray-700' />
        <div className='flex items-center gap-[-4px]'>
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className='h-[18px] w-[18px] animate-pulse rounded-[4px] bg-gray-700'
            />
          ))}
        </div>
      </div>

      {/* Creator and stats row skeleton */}
      <div className='mt-[14px] flex items-center justify-between'>
        <div className='flex items-center gap-[8px]'>
          <div className='h-[14px] w-[14px] animate-pulse rounded-full bg-gray-700' />
          <div className='h-3 w-20 animate-pulse rounded bg-gray-700' />
        </div>
        <div className='flex items-center gap-[6px]'>
          <div className='h-3 w-3 animate-pulse rounded bg-gray-700' />
          <div className='h-3 w-6 animate-pulse rounded bg-gray-700' />
          <div className='h-3 w-3 animate-pulse rounded bg-gray-700' />
          <div className='h-3 w-6 animate-pulse rounded bg-gray-700' />
        </div>
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

// Utility function to get the full block config for colored icon display
const getBlockConfig = (blockType: string) => {
  const block = getBlock(blockType)
  return block
}

/**
 * Normalize an arbitrary workflow-like object into a valid WorkflowState for preview rendering.
 * Ensures required fields exist: blocks with required properties, edges array, loops and parallels maps.
 */
function normalizeWorkflowState(input?: any): WorkflowState | null {
  if (!input || !input.blocks) return null

  const normalizedBlocks: WorkflowState['blocks'] = {}
  for (const [id, raw] of Object.entries<any>(input.blocks || {})) {
    if (!raw || !raw.type) continue
    normalizedBlocks[id] = {
      id: raw.id ?? id,
      type: raw.type,
      name: raw.name ?? raw.type,
      position: raw.position ?? { x: 0, y: 0 },
      subBlocks: raw.subBlocks ?? {},
      outputs: raw.outputs ?? {},
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      horizontalHandles: raw.horizontalHandles,
      height: raw.height,
      advancedMode: raw.advancedMode,
      triggerMode: raw.triggerMode,
      data: raw.data ?? {},
      layout: raw.layout,
    }
  }

  const normalized: WorkflowState = {
    blocks: normalizedBlocks,
    edges: Array.isArray(input.edges) ? input.edges : [],
    loops: input.loops ?? {},
    parallels: input.parallels ?? {},
    lastSaved: input.lastSaved,
    lastUpdate: input.lastUpdate,
    metadata: input.metadata,
    variables: input.variables,
    isDeployed: input.isDeployed,
    deployedAt: input.deployedAt,
    deploymentStatuses: input.deploymentStatuses,
    needsRedeployment: input.needsRedeployment,
    dragStartPosition: input.dragStartPosition ?? null,
  }

  return normalized
}

function TemplateCardInner({
  id,
  title,
  description,
  author,
  authorImageUrl,
  usageCount,
  stars = 0,
  icon,
  iconColor = 'bg-blue-500',
  blocks = [],
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

  // Memoize normalized workflow state to avoid recalculation on every render
  const normalizedState = useMemo(() => normalizeWorkflowState(state), [state])

  // Use IntersectionObserver to defer rendering the heavy WorkflowPreview until in viewport
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    if (!previewRef.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    )
    observer.observe(previewRef.current)
    return () => observer.disconnect()
  }, [])

  // Extract block types from state if provided, otherwise use the blocks prop
  // Filter out starter blocks in both cases and sort for consistent rendering
  // Memoized to prevent recalculation on every render
  const blockTypes = useMemo(
    () =>
      state
        ? extractBlockTypesFromState(state)
        : blocks.filter((blockType) => blockType !== 'starter').sort(),
    [state, blocks]
  )

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

  /**
   * Get the appropriate template detail page URL based on context.
   * If we're in a workspace context, navigate to the workspace template page.
   * Otherwise, navigate to the global template page.
   * Memoized to avoid recalculation on every render.
   */
  const templateUrl = useMemo(() => {
    const workspaceId = params?.workspaceId as string | undefined
    if (workspaceId) {
      return `/workspace/${workspaceId}/templates/${id}`
    }
    return `/templates/${id}`
  }, [params?.workspaceId, id])

  /**
   * Handle use button click - navigate to template detail page
   */
  const handleUseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      router.push(templateUrl)
    },
    [router, templateUrl]
  )

  /**
   * Handle card click - navigate to template detail page
   */
  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't navigate if clicking on action buttons
      const target = e.target as HTMLElement
      if (target.closest('button') || target.closest('[data-action]')) {
        return
      }

      router.push(templateUrl)
    },
    [router, templateUrl]
  )

  return (
    <div
      onClick={handleCardClick}
      className={cn('w-full cursor-pointer rounded-[8px] bg-[#202020] p-[8px]', className)}
    >
      {/* Workflow Preview */}
      <div
        ref={previewRef}
        className='pointer-events-none h-[180px] w-full overflow-hidden rounded-[6px]'
      >
        {normalizedState && isInView ? (
          <WorkflowPreview
            workflowState={normalizedState}
            showSubBlocks={false}
            height={180}
            width='100%'
            isPannable={false}
            defaultZoom={0.8}
            fitPadding={0.2}
          />
        ) : (
          <div className='h-full w-full bg-[#2A2A2A]' />
        )}
      </div>

      {/* Title and Blocks Row */}
      <div className='mt-[10px] flex items-center justify-between'>
        {/* Template Name */}
        <h3 className='truncate pr-[8px] pl-[2px] font-medium text-[16px] text-white'>{title}</h3>

        {/* Block Icons */}
        <div className='flex flex-shrink-0'>
          {blockTypes.length > 4 ? (
            <>
              {/* Show first 3 blocks when there are more than 4 */}
              {blockTypes.slice(0, 3).map((blockType, index) => {
                const blockConfig = getBlockConfig(blockType)
                if (!blockConfig) return null

                return (
                  <div
                    key={index}
                    className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]'
                    style={{
                      backgroundColor: blockConfig.bgColor || 'gray',
                      marginLeft: index > 0 ? '-4px' : '0',
                    }}
                  >
                    <blockConfig.icon className='h-[10px] w-[10px] text-white' />
                  </div>
                )
              })}
              {/* Show +n for remaining blocks */}
              <div
                className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] bg-[#4A4A4A]'
                style={{ marginLeft: '-4px' }}
              >
                <span className='font-medium text-[10px] text-white'>+{blockTypes.length - 3}</span>
              </div>
            </>
          ) : (
            /* Show all blocks when 4 or fewer */
            blockTypes.map((blockType, index) => {
              const blockConfig = getBlockConfig(blockType)
              if (!blockConfig) return null

              return (
                <div
                  key={index}
                  className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]'
                  style={{
                    backgroundColor: blockConfig.bgColor || 'gray',
                    marginLeft: index > 0 ? '-4px' : '0',
                  }}
                >
                  <blockConfig.icon className='h-[10px] w-[10px] text-white' />
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Creator and Stats Row */}
      <div className='mt-[10px] flex items-center justify-between'>
        {/* Creator Info */}
        <div className='flex items-center gap-[8px]'>
          {authorImageUrl ? (
            <div className='h-[26px] w-[26px] flex-shrink-0 overflow-hidden rounded-full'>
              <img src={authorImageUrl} alt={author} className='h-full w-full object-cover' />
            </div>
          ) : (
            <div className='flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-[#4A4A4A]'>
              <User className='h-[18px] w-[18px] text-[#888888]' />
            </div>
          )}
          <span className='truncate font-medium text-[#888888] text-[12px]'>{author}</span>
        </div>

        {/* Stats */}
        <div className='flex flex-shrink-0 items-center gap-[6px] font-medium text-[#888888] text-[12px]'>
          <User className='h-[12px] w-[12px]' />
          <span>{usageCount}</span>
          <Star
            onClick={handleStarClick}
            className={cn(
              'h-[12px] w-[12px] cursor-pointer transition-colors',
              localIsStarred ? 'fill-yellow-500 text-yellow-500' : 'text-[#888888]',
              isStarLoading && 'opacity-50'
            )}
          />
          <span>{localStarCount}</span>
        </div>
      </div>
    </div>
  )
}

export const TemplateCard = memo(TemplateCardInner)
