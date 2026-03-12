'use client'

import {
  type ReactNode,
  type RefCallback,
  type SVGProps,
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { PanelLeft, Plus } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useAddChatResource, useRemoveChatResource } from '@/hooks/queries/tasks'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { getResourceConfig, RESOURCE_TYPES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'

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
  workspaceId: string
  chatId?: string
  resources: MothershipResource[]
  activeId: string | null
  onSelect: (id: string) => void
  onAddResource: (resource: MothershipResource) => void
  onRemoveResource: (resourceType: MothershipResourceType, resourceId: string) => void
  onCollapse: () => void
  previewMode?: PreviewMode
  onCyclePreviewMode?: () => void
  actions?: ReactNode
}

export function ResourceTabs({
  workspaceId,
  chatId,
  resources,
  activeId,
  onSelect,
  onAddResource,
  onRemoveResource,
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

  const addResource = useAddChatResource(chatId)
  const removeResource = useRemoveChatResource(chatId)

  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)

  const existingKeys = useMemo(
    () => new Set(resources.map((r) => `${r.type}:${r.id}`)),
    [resources]
  )

  const handleAdd = useCallback(
    (resource: MothershipResource) => {
      if (!chatId) return
      addResource.mutate({ chatId, resource })
      onAddResource(resource)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, onAddResource]
  )

  const handleRemove = useCallback(
    (e: React.MouseEvent, resource: MothershipResource) => {
      e.stopPropagation()
      if (!chatId) return
      removeResource.mutate({ chatId, resourceType: resource.type, resourceId: resource.id })
      onRemoveResource(resource.type, resource.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, onRemoveResource]
  )

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
          const config = getResourceConfig(resource.type)
          const isActive = activeId === resource.id
          const isHovered = hoveredTabId === resource.id

          return (
            <Tooltip.Root key={resource.id}>
              <Tooltip.Trigger asChild>
                <Button
                  variant='subtle'
                  onClick={() => onSelect(resource.id)}
                  onMouseEnter={() => setHoveredTabId(resource.id)}
                  onMouseLeave={() => setHoveredTabId(null)}
                  className={cn(
                    'group relative shrink-0 bg-transparent px-[8px] py-[4px] pr-[22px] text-[12px]',
                    isActive && 'bg-[var(--surface-4)]'
                  )}
                >
                  {config.renderTabIcon(resource, 'mr-[6px] h-[14px] w-[14px]')}
                  {resource.title}
                  {(isHovered || isActive) && chatId && (
                    <span
                      role='button'
                      tabIndex={-1}
                      onClick={(e) => handleRemove(e, resource)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRemove(e as unknown as React.MouseEvent, resource) }}
                      className='absolute right-[4px] top-1/2 flex -translate-y-1/2 items-center justify-center rounded-[4px] p-[1px] hover:bg-[var(--surface-5)]'
                      aria-label={`Close ${resource.title}`}
                    >
                      <svg className='h-[10px] w-[10px] text-[var(--text-tertiary)]' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'>
                        <path d='M18 6 6 18M6 6l12 12' />
                      </svg>
                    </span>
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='bottom'>
                <p>{resource.title}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          )
        })}
        {chatId && (
          <AddResourceDropdown
            workspaceId={workspaceId}
            existingKeys={existingKeys}
            onAdd={handleAdd}
          />
        )}
      </div>
      {(actions || (previewMode && onCyclePreviewMode)) && (
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
      )}
    </div>
  )
}

interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
}

const EMPTY_SUBMENU = (
  <DropdownMenuItem disabled>
    <span className='text-[13px] text-[var(--text-tertiary)]'>None available</span>
  </DropdownMenuItem>
)

type AvailableItem = { id: string; name: string; [key: string]: unknown }

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

function useAvailableResources(workspaceId: string, existingKeys: Set<string>): AvailableItemsByType[] {
  const { data: workflows = [] } = useWorkflows(workspaceId, { syncRegistry: false })
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)

  return useMemo(() => [
    {
      type: 'workflow' as const,
      items: workflows
        .filter((w) => !existingKeys.has(`workflow:${w.id}`))
        .map((w) => ({ id: w.id, name: w.name, color: w.color })),
    },
    {
      type: 'table' as const,
      items: tables
        .filter((t) => !existingKeys.has(`table:${t.id}`))
        .map((t) => ({ id: t.id, name: t.name })),
    },
    {
      type: 'file' as const,
      items: files
        .filter((f) => !existingKeys.has(`file:${f.id}`))
        .map((f) => ({ id: f.id, name: f.name })),
    },
    {
      type: 'knowledgebase' as const,
      items: (knowledgeBases ?? [])
        .filter((kb) => !existingKeys.has(`knowledgebase:${kb.id}`))
        .map((kb) => ({ id: kb.id, name: kb.name })),
    },
  ], [workflows, tables, files, knowledgeBases, existingKeys])
}

function AddResourceDropdown({ workspaceId, existingKeys, onAdd }: AddResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const available = useAvailableResources(workspaceId, existingKeys)

  const select = useCallback(
    (resource: MothershipResource) => {
      onAdd(resource)
      setOpen(false)
    },
    [onAdd]
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant='subtle'
              className='shrink-0 bg-transparent px-[8px] py-[5px] text-[12px]'
              aria-label='Add resource tab'
            >
              <Plus className='h-[14px] w-[14px] text-[var(--text-icon)]' />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Add resource</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenuContent align='start' className='w-[200px]'>
        {available.map(({ type, items }) => {
          const config = getResourceConfig(type)
          const Icon = config.icon
          return (
            <DropdownMenuSub key={type}>
              <DropdownMenuSubTrigger>
                <Icon className='mr-[8px] h-[14px] w-[14px] text-[var(--text-icon)]' />
                {config.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className='max-h-[280px] w-[220px] overflow-y-auto'>
                {items.length > 0
                  ? items.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => select({ type, id: item.id, title: item.name })}
                      >
                        {config.renderDropdownItem({ item })}
                      </DropdownMenuItem>
                    ))
                  : EMPTY_SUBMENU}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
