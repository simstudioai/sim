'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/emcn'
import { Plus } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

export interface AddResourceDropdownProps {
  workspaceId: string
  existingKeys: Set<string>
  onAdd: (resource: MothershipResource) => void
  onSwitch?: (resourceId: string) => void
}

export type AvailableItem = { id: string; name: string; isOpen?: boolean; [key: string]: unknown }

interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

export function useAvailableResources(
  workspaceId: string,
  existingKeys: Set<string>
): AvailableItemsByType[] {
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases } = useKnowledgeBasesQuery(workspaceId)
  const { data: folders = [] } = useFolders(workspaceId)

  return useMemo(
    () => [
      {
        type: 'workflow' as const,
        items: workflows.map((w) => ({
          id: w.id,
          name: w.name,
          color: w.color,
          isOpen: existingKeys.has(`workflow:${w.id}`),
        })),
      },
      {
        type: 'folder' as const,
        items: folders.map((f) => ({
          id: f.id,
          name: f.name,
          isOpen: existingKeys.has(`folder:${f.id}`),
        })),
      },
      {
        type: 'table' as const,
        items: tables.map((t) => ({
          id: t.id,
          name: t.name,
          isOpen: existingKeys.has(`table:${t.id}`),
        })),
      },
      {
        type: 'file' as const,
        items: files.map((f) => ({
          id: f.id,
          name: f.name,
          isOpen: existingKeys.has(`file:${f.id}`),
        })),
      },
      {
        type: 'knowledgebase' as const,
        items: (knowledgeBases ?? []).map((kb) => ({
          id: kb.id,
          name: kb.name,
          isOpen: existingKeys.has(`knowledgebase:${kb.id}`),
        })),
      },
    ],
    [workflows, folders, tables, files, knowledgeBases, existingKeys]
  )
}

export function AddResourceDropdown({
  workspaceId,
  existingKeys,
  onAdd,
  onSwitch,
}: AddResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const available = useAvailableResources(workspaceId, existingKeys)

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setSearch('')
      setActiveIndex(0)
    }
  }, [])

  const select = useCallback(
    (resource: MothershipResource, isOpen?: boolean) => {
      if (isOpen && onSwitch) {
        onSwitch(resource.id)
      } else {
        onAdd(resource)
      }
      setOpen(false)
      setSearch('')
      setActiveIndex(0)
    },
    [onAdd, onSwitch]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return null
    return available.flatMap(({ type, items }) =>
      items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => ({ type, item }))
    )
  }, [search, available])

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!filtered) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered.length > 0 && filtered[activeIndex]) {
          const { type, item } = filtered[activeIndex]
          select({ type, id: item.id, title: item.name }, item.isOpen)
        }
      }
    },
    [filtered, activeIndex, select]
  )

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant='subtle'
              className={RESOURCE_TAB_ICON_BUTTON_CLASS}
              aria-label='Add resource tab'
            >
              <Plus className={RESOURCE_TAB_ICON_CLASS} />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <p>Add resource</p>
        </Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenuContent
        align='start'
        sideOffset={8}
        className='flex w-[240px] flex-col overflow-hidden'
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuSearchInput
          placeholder='Search resources...'
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleSearchKeyDown}
        />
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {filtered ? (
            filtered.length > 0 ? (
              filtered.map(({ type, item }, index) => {
                const config = getResourceConfig(type)
                return (
                  <DropdownMenuItem
                    key={`${type}:${item.id}`}
                    className={cn(index === activeIndex && 'bg-[var(--surface-active)]')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select({ type, id: item.id, title: item.name }, item.isOpen)}
                  >
                    {config.renderDropdownItem({ item })}
                    <span className='ml-auto pl-2 text-[var(--text-tertiary)] text-xs'>
                      {config.label}
                    </span>
                  </DropdownMenuItem>
                )
              })
            ) : (
              <div className='px-2 py-1.5 text-center font-medium text-[var(--text-tertiary)] text-caption'>
                No results
              </div>
            )
          ) : (
            <>
              {available.map(({ type, items }) => {
                if (items.length === 0) return null
                const config = getResourceConfig(type)
                const Icon = config.icon
                return (
                  <DropdownMenuSub key={type}>
                    <DropdownMenuSubTrigger>
                      {type === 'workflow' ? (
                        <div
                          className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                          style={{
                            backgroundColor: '#808080',
                            borderColor: '#80808060',
                            backgroundClip: 'padding-box',
                          }}
                        />
                      ) : (
                        <Icon className='h-[14px] w-[14px]' />
                      )}
                      <span>{config.label}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {items.map((item) => (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() =>
                            select({ type, id: item.id, title: item.name }, item.isOpen)
                          }
                        >
                          {config.renderDropdownItem({ item })}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )
              })}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
