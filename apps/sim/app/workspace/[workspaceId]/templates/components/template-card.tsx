import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Star, User } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import { getBlock } from '@/blocks/registry'
import { useStarTemplate } from '@/hooks/queries/templates'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('TemplateCard')

interface TemplateCardProps {
  id: string
  title: string
  author: string
  authorImageUrl?: string | null
  usageCount: string
  stars?: number
  blocks?: string[]
  className?: string
  state?: WorkflowState
  isStarred?: boolean
}

export function TemplateCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('h-[268px] w-full rounded-[8px] bg-[#202020] p-[8px]', className)}>
      <div className='h-[180px] w-full animate-pulse rounded-[6px] bg-gray-700' />

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

const extractBlockTypesFromState = (state?: {
  blocks?: Record<string, { type: string; name?: string }>
}): string[] => {
  if (!state?.blocks) return []

  const blockTypes = Object.keys(state.blocks)
    .sort()
    .map((key) => state.blocks![key].type)
    .filter((type) => type !== 'starter')
  return [...new Set(blockTypes)]
}

const getBlockConfig = (blockType: string) => {
  const block = getBlock(blockType)
  return block
}

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
  author,
  authorImageUrl,
  usageCount,
  stars = 0,
  blocks = [],
  className,
  state,
  isStarred = false,
}: TemplateCardProps) {
  const router = useRouter()
  const params = useParams()

  const { mutate: toggleStar, isPending: isStarLoading } = useStarTemplate()

  const normalizedState = useMemo(() => normalizeWorkflowState(state), [state])

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

  const blockTypes = useMemo(
    () =>
      state
        ? extractBlockTypesFromState(state)
        : blocks.filter((blockType) => blockType !== 'starter').sort(),
    [state, blocks]
  )

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isStarLoading) return

    toggleStar({
      templateId: id,
      action: isStarred ? 'remove' : 'add',
    })
  }

  const templateUrl = useMemo(() => {
    const workspaceId = params?.workspaceId as string | undefined
    if (workspaceId) {
      return `/workspace/${workspaceId}/templates/${id}`
    }
    return `/templates/${id}`
  }, [params?.workspaceId, id])

  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
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

      <div className='mt-[10px] flex items-center justify-between'>
        <h3 className='truncate pr-[8px] pl-[2px] font-medium text-[16px] text-white'>{title}</h3>

        <div className='flex flex-shrink-0'>
          {blockTypes.length > 4 ? (
            <>
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
              <div
                className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] bg-[#4A4A4A]'
                style={{ marginLeft: '-4px' }}
              >
                <span className='font-medium text-[10px] text-white'>+{blockTypes.length - 3}</span>
              </div>
            </>
          ) : (
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

      <div className='mt-[10px] flex items-center justify-between'>
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

        <div className='flex flex-shrink-0 items-center gap-[6px] font-medium text-[#888888] text-[12px]'>
          <User className='h-[12px] w-[12px]' />
          <span>{usageCount}</span>
          <Star
            onClick={handleStarClick}
            className={cn(
              'h-[12px] w-[12px] cursor-pointer transition-colors',
              isStarred ? 'fill-yellow-500 text-yellow-500' : 'text-[#888888]',
              isStarLoading && 'opacity-50'
            )}
          />
          <span>{stars}</span>
        </div>
      </div>
    </div>
  )
}

export const TemplateCard = memo(TemplateCardInner)
