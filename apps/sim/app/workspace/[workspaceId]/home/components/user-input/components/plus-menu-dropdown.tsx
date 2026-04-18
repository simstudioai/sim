'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Plus, Sim } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  buildWorkflowFolderTree,
  type useAvailableResources,
  WorkflowFolderTreeItems,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

export type AvailableResourceGroup = ReturnType<typeof useAvailableResources>[number]

interface PlusMenuDropdownProps {
  availableResources: AvailableResourceGroup[]
  onResourceSelect: (resource: MothershipResource) => void
  onFileSelect: () => void
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pendingCursorRef: React.MutableRefObject<number | null>
}

export const PlusMenuDropdown = React.memo(
  React.forwardRef<PlusMenuHandle, PlusMenuDropdownProps>(function PlusMenuDropdown(
    { availableResources, onResourceSelect, onFileSelect, onClose, textareaRef, pendingCursorRef },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    const doOpen = useCallback((anchor?: { left: number; top: number }) => {
      if (anchor) {
        setAnchorPos(anchor)
      } else {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (!rect) return
        setAnchorPos({ left: rect.left, top: rect.top })
      }
      setOpen(true)
      setSearch('')
      setActiveIndex(0)
    }, [])

    React.useImperativeHandle(ref, () => ({ open: doOpen }), [doOpen])

    const workflowTree = useMemo(() => {
      const workflowGroup = availableResources.find((g) => g.type === 'workflow')
      const folderGroup = availableResources.find((g) => g.type === 'folder')
      return buildWorkflowFolderTree(workflowGroup?.items ?? [], folderGroup?.items ?? [])
    }, [availableResources])

    const filteredItems = useMemo(() => {
      const q = search.toLowerCase().trim()
      if (!q) return null
      return availableResources.flatMap(({ type, items }) =>
        items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => ({ type, item }))
      )
    }, [search, availableResources])

    const handleSelect = (resource: MothershipResource) => {
      onResourceSelect(resource)
      setOpen(false)
      setSearch('')
      setActiveIndex(0)
    }

    // Sync DOM scroll to the keyboard-highlighted filtered row.
    useEffect(() => {
      if (!filteredItems || filteredItems.length === 0) return
      const row = contentRef.current?.querySelector<HTMLElement>(
        `[data-filtered-idx="${activeIndex}"]`
      )
      row?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex, filteredItems])

    const getVisibleMenuItems = (): HTMLElement[] =>
      Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
      ).filter((el) => el.offsetParent !== null)

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!filteredItems) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          getVisibleMenuItems()[0]?.focus()
        }
        return
      }
      if (filteredItems.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault()
        const target = filteredItems[activeIndex] ?? filteredItems[0]
        if (target) handleSelect({ type: target.type, id: target.item.id, title: target.item.name })
      }
    }

    const handleContentKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowUp') {
        const items = getVisibleMenuItems()
        if (items[0] && items[0] === document.activeElement) {
          e.preventDefault()
          searchRef.current?.focus()
        }
      } else if (e.key === 'Tab') {
        const focused = document.activeElement as HTMLElement | null
        if (focused?.getAttribute('role') === 'menuitem') {
          e.preventDefault()
          focused.click()
        }
      }
    }

    const handleOpenChange = (isOpen: boolean) => {
      setOpen(isOpen)
      if (!isOpen) {
        setSearch('')
        setAnchorPos(null)
        setActiveIndex(0)
        onClose()
      }
    }

    const handleCloseAutoFocus = (e: Event) => {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      if (pendingCursorRef.current !== null) {
        textarea.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
        pendingCursorRef.current = null
      }
      textarea.focus()
    }

    return (
      <>
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <div
              style={{
                position: 'fixed',
                left: anchorPos?.left ?? 0,
                top: anchorPos?.top ?? 0,
                width: 0,
                height: 0,
                pointerEvents: 'none',
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            ref={contentRef}
            align='start'
            side='top'
            sideOffset={8}
            className='flex w-[320px] flex-col overflow-hidden'
            onCloseAutoFocus={handleCloseAutoFocus}
            onKeyDown={handleContentKeyDown}
          >
            <DropdownMenuSearchInput
              ref={searchRef}
              placeholder='Search resources...'
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <div className='min-h-0 flex-1 overflow-y-auto'>
              {/* Always-mounted; swapping this subtree with filtered results makes Radix's
                  menu FocusScope steal focus from the search input back to the content root. */}
              <div hidden={filteredItems !== null}>
                <DropdownMenuItem
                  onClick={() => {
                    setOpen(false)
                    onFileSelect()
                  }}
                >
                  <Paperclip className='h-[14px] w-[14px]' strokeWidth={2} />
                  <span>Attachments</span>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sim className='h-[14px] w-[14px]' fill='currentColor' />
                    <span>Workspace</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {workflowTree.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <div
                            className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                            style={{
                              backgroundColor: '#808080',
                              borderColor: '#80808060',
                              backgroundClip: 'padding-box',
                            }}
                          />
                          <span>Workflows</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <WorkflowFolderTreeItems nodes={workflowTree} onSelect={handleSelect} />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    {availableResources
                      .filter(({ type }) => type !== 'workflow' && type !== 'folder')
                      .map(({ type, items }) => {
                        if (items.length === 0) return null
                        const config = getResourceConfig(type)
                        const Icon = config.icon
                        return (
                          <DropdownMenuSub key={type}>
                            <DropdownMenuSubTrigger>
                              <Icon className='h-[14px] w-[14px]' />
                              <span>{config.label}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {items.map((item) => (
                                <DropdownMenuItem
                                  key={item.id}
                                  onClick={() => {
                                    handleSelect({ type, id: item.id, title: item.name })
                                  }}
                                >
                                  {config.renderDropdownItem({ item })}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )
                      })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </div>
              {/* Plain buttons, not DropdownMenuItem: mount/unmount must not mutate Radix's
                  menu Collection, or FocusScope restores focus to the content root. */}
              {filteredItems !== null &&
                (filteredItems.length > 0 ? (
                  filteredItems.map(({ type, item }, index) => {
                    const config = getResourceConfig(type)
                    const isActive = index === activeIndex
                    return (
                      <button
                        key={`${type}:${item.id}`}
                        type='button'
                        role='menuitem'
                        data-filtered-idx={index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          handleSelect({ type, id: item.id, title: item.name })
                        }}
                        className={cn(
                          'relative flex w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-1.5 text-left font-medium text-[var(--text-body)] text-caption outline-none transition-colors [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]',
                          isActive && 'bg-[var(--surface-active)]'
                        )}
                      >
                        {config.renderDropdownItem({ item })}
                      </button>
                    )
                  })
                ) : (
                  <div className='px-2 py-1.5 text-center font-medium text-[var(--text-tertiary)] text-caption'>
                    No results
                  </div>
                ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          ref={buttonRef}
          type='button'
          onClick={() => doOpen()}
          className='flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[var(--border-1)] transition-colors hover:bg-[var(--surface-hover)]'
          title='Add attachments or resources'
        >
          <Plus className='h-[16px] w-[16px] text-[var(--text-icon)]' />
        </button>
      </>
    )
  })
)
