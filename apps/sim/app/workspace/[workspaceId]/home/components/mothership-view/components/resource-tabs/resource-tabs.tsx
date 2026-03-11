'use client'

import {
  type ElementType,
  type ReactNode,
  type RefCallback,
  type SVGProps,
  useCallback,
} from 'react'
import { Button, Tooltip } from '@/components/emcn'
import { PanelLeft, Table as TableIcon } from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

const LEFT_HALF =
  'M10.25 0.75H3.25C1.86929 0.75 0.75 1.86929 0.75 3.25V16.25C0.75 17.6307 1.86929 18.75 3.25 18.75H10.25V0.75Z'
const RIGHT_HALF =
  'M10.25 0.75H17.25C18.6307 0.75 19.75 1.86929 19.75 3.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H10.25V0.75Z'
const OUTLINE =
  'M0.75 3.25C0.75 1.86929 1.86929 0.75 3.25 0.75H17.25C18.6307 0.75 19.75 1.86929 19.75 3.25V16.25C19.75 17.6307 18.6307 18.75 17.25 18.75H3.25C1.86929 18.75 0.75 17.6307 0.75 16.25V3.25Z'

function PreviewModeIcon({ mode, ...props }: { mode: PreviewMode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1 -2 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      {mode !== 'preview' && <path d={LEFT_HALF} fill='var(--surface-active)' stroke='none' />}
      {mode !== 'editor' && <path d={RIGHT_HALF} fill='var(--surface-active)' stroke='none' />}
      <path d={OUTLINE} />
      <path d='M10.25 0.75V18.75' />
    </svg>
  )
}

interface ResourceTabsProps {
  resources: MothershipResource[]
  activeId: string | null
  onSelect: (id: string) => void
  onCollapse: () => void
  previewMode?: PreviewMode
  onCyclePreviewMode?: () => void
  actions?: ReactNode
}

const RESOURCE_ICONS: Record<Exclude<MothershipResourceType, 'file'>, ElementType> = {
  table: TableIcon,
  workflow: WorkflowIcon,
}

function getResourceIcon(resource: MothershipResource): ElementType {
  if (resource.type === 'file') {
    return getDocumentIcon('', resource.title)
  }
  return RESOURCE_ICONS[resource.type]
}

/**
 * Horizontal tab bar for switching between mothership resources.
 * Renders each resource as a subtle Button matching ResourceHeader actions.
 */
export function ResourceTabs({
  resources,
  activeId,
  onSelect,
  onCollapse,
  previewMode,
  onCyclePreviewMode,
  actions,
}: ResourceTabsProps) {
  const scrollRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    if (!node) return
    const handler = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        node.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [])

  return (
    <div className='flex shrink-0 items-center border-[var(--border)] border-b px-[16px] py-[8.5px]'>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='subtle'
            onClick={onCollapse}
            className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
            aria-label='Collapse resource view'
          >
            <PanelLeft className='-scale-x-100 h-[16px] w-[16px] text-[var(--text-icon)]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Collapse</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <div
        ref={scrollRef}
        className='mx-[2px] flex min-w-0 items-center gap-[6px] overflow-x-auto px-[6px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      >
        {resources.map((resource) => {
          const Icon = getResourceIcon(resource)
          const isActive = activeId === resource.id

          return (
            <Tooltip.Root key={resource.id}>
              <Tooltip.Trigger asChild>
                <Button
                  variant='subtle'
                  onClick={() => onSelect(resource.id)}
                  className={cn(
                    'shrink-0 bg-transparent px-[8px] py-[4px] text-[12px]',
                    isActive && 'bg-[var(--surface-4)]'
                  )}
                >
                  <Icon className={cn('mr-[6px] h-[14px] w-[14px] text-[var(--text-icon)]')} />
                  {resource.title}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='bottom'>
                <p>{resource.title}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )
        })}
      </div>
      <div className='ml-auto flex shrink-0 items-center gap-[6px]'>
        {actions}
        {previewMode && onCyclePreviewMode && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='subtle'
                onClick={onCyclePreviewMode}
                className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
                aria-label='Cycle preview mode'
              >
                <PreviewModeIcon
                  mode={previewMode}
                  className='h-[16px] w-[16px] text-[var(--text-icon)]'
                />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='bottom'>
              <p>Preview mode</p>
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    </div>
  )
}
