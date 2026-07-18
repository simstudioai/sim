'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Workflow } from '@sim/emcn/icons'
import {
  buildFileFolderTree,
  buildWorkflowFolderTree,
  FileFolderTreeItems,
  type useAvailableResources,
  WorkflowFolderTreeItems,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

export type AvailableResourceGroup = ReturnType<typeof useAvailableResources>[number]

/**
 * Resource types that are only offered via `@`-mention autocomplete and hidden
 * from the `+` browse menu. Integrations are searchable inline (e.g. typing
 * `@sla` surfaces Slack) but should not clutter the explicit attach menu.
 */
const MENTION_ONLY_RESOURCE_TYPES = new Set<MothershipResourceType>(['integration'])
const NON_ATTACHABLE_RESOURCE_TYPES = new Set<MothershipResourceType>(['browser'])

interface PlusMenuDropdownProps {
  availableResources: AvailableResourceGroup[]
  onResourceSelect: (resource: MothershipResource) => void
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pendingCursorRef: React.MutableRefObject<number | null>
  /** When in mention mode the dropdown hides its search input and uses this query for filtering. */
  mentionQuery?: string
}

export const PlusMenuDropdown = React.memo(
  React.forwardRef<PlusMenuHandle, PlusMenuDropdownProps>(function PlusMenuDropdown(
    { availableResources, onResourceSelect, onClose, textareaRef, pendingCursorRef, mentionQuery },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [isMention, setIsMention] = useState(false)
    const [search, setSearch] = useState('')
    const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const searchRef = useRef<HTMLInputElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    const doOpen = useCallback(
      (anchor: { left: number; top: number }, options?: { mention?: boolean }) => {
        setAnchorPos(anchor)
        setIsMention(!!options?.mention)
        setOpen(true)
        setSearch('')
        setActiveIndex(0)
      },
      []
    )

    const doClose = useCallback(() => {
      setOpen(false)
    }, [])

    // The `+` browse menu hides mention-only resource types; `@`-mention mode
    // exposes the full catalog so integrations remain searchable inline.
    const visibleResources = useMemo(() => {
      const attachable = availableResources.filter(
        ({ type }) => !NON_ATTACHABLE_RESOURCE_TYPES.has(type)
      )
      return isMention
        ? attachable
        : attachable.filter(({ type }) => !MENTION_ONLY_RESOURCE_TYPES.has(type))
    }, [isMention, availableResources])

    const workflowTree = useMemo(() => {
      const workflowGroup = visibleResources.find((g) => g.type === 'workflow')
      const folderGroup = visibleResources.find((g) => g.type === 'folder')
      return buildWorkflowFolderTree(workflowGroup?.items ?? [], folderGroup?.items ?? [])
    }, [visibleResources])

    const fileFolderTree = useMemo(() => {
      const fileGroup = visibleResources.find((g) => g.type === 'file')
      const fileFolderGroup = visibleResources.find((g) => g.type === 'filefolder')
      return buildFileFolderTree(fileGroup?.items ?? [], fileFolderGroup?.items ?? [])
    }, [visibleResources])

    const filteredItems = useMemo(() => {
      const rawQuery = isMention ? (mentionQuery ?? '') : search
      const q = rawQuery.toLowerCase().trim()
      // In mention mode always render a flat filtered list — empty query = show everything.
      if (!isMention && !q) return null
      if (isMention && !q) {
        return visibleResources.flatMap(({ type, items }) => items.map((item) => ({ type, item })))
      }
      return visibleResources.flatMap(({ type, items }) =>
        items.filter((item) => item.name.toLowerCase().includes(q)).map((item) => ({ type, item }))
      )
    }, [isMention, mentionQuery, search, visibleResources])

    const filteredItemsRef = useRef(filteredItems)
    filteredItemsRef.current = filteredItems
    const activeIndexRef = useRef(activeIndex)
    activeIndexRef.current = activeIndex
    const isMentionRef = useRef(isMention)
    isMentionRef.current = isMention

    // Reset highlight to the top whenever the mention query changes so the user always
    // sees the best match selected as they type.
    useEffect(() => {
      if (isMention) setActiveIndex(0)
    }, [isMention, mentionQuery])

    const handleSelect = (resource: MothershipResource) => {
      onResourceSelect(resource)
      setOpen(false)
      setSearch('')
      setActiveIndex(0)
    }

    const handleSelectRef = useRef(handleSelect)
    handleSelectRef.current = handleSelect

    React.useImperativeHandle(
      ref,
      () => ({
        open: doOpen,
        close: doClose,
        moveActive: (delta: number) => {
          const items = filteredItemsRef.current
          if (!items || items.length === 0) return
          setActiveIndex((i) => {
            const next = i + delta
            if (next < 0) return items.length - 1
            if (next >= items.length) return 0
            return next
          })
        },
        selectActive: () => {
          const items = filteredItemsRef.current
          if (!items || items.length === 0) return false
          const target = items[activeIndexRef.current] ?? items[0]
          if (!target) return false
          handleSelectRef.current({
            type: target.type,
            id: target.item.id,
            title: target.item.name,
          })
          return true
        },
      }),
      [doOpen, doClose]
    )

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

    // Radix's FocusScope normally focuses the content on open and traps focus inside.
    // Preventing the mount auto-focus keeps the textarea focused AND, because the focus
    // trap activates on focusin, the trap stays dormant — typing continues uninterrupted.
    const handleOpenAutoFocus = (e: Event) => {
      if (isMentionRef.current) e.preventDefault()
    }

    return (
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
          avoidCollisions
          collisionPadding={8}
          className={cn(
            'flex flex-col overflow-hidden',
            // Plus-click shows short fixed labels (Workflows, Tables, …) — let it size
            // to its content via the emcn DropdownMenuContent default max-w.
            // Mention mode renders resource names directly, so widen for breathing room.
            isMention && 'max-w-[min(300px,calc(100vw-32px))]'
          )}
          onCloseAutoFocus={handleCloseAutoFocus}
          onOpenAutoFocus={handleOpenAutoFocus}
          onKeyDown={handleContentKeyDown}
        >
          {!isMention && (
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
          )}
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-none'>
            {/* Always-mounted; swapping this subtree with filtered results makes Radix's
                  menu FocusScope steal focus from the search input back to the content root. */}
            <div hidden={filteredItems !== null}>
              {workflowTree.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Workflow className='size-[14px]' />
                    <span>Workflows</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='max-w-[min(300px,calc(100vw-32px))]'>
                    <WorkflowFolderTreeItems nodes={workflowTree} onSelect={handleSelect} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {fileFolderTree.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {(() => {
                      const Icon = getResourceConfig('file').icon
                      return <Icon className='size-[14px]' />
                    })()}
                    <span>Files</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='max-w-[min(300px,calc(100vw-32px))]'>
                    <FileFolderTreeItems nodes={fileFolderTree} onSelect={handleSelect} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {visibleResources
                .filter(
                  ({ type }) =>
                    type !== 'workflow' &&
                    type !== 'folder' &&
                    type !== 'file' &&
                    type !== 'filefolder'
                )
                .map(({ type, items }) => {
                  if (items.length === 0) return null
                  const config = getResourceConfig(type)
                  const Icon = config.icon
                  return (
                    <DropdownMenuSub key={type}>
                      <DropdownMenuSubTrigger>
                        <Icon className='size-[14px]' />
                        <span>{config.label}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className='max-w-[min(300px,calc(100vw-32px))]'>
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
    )
  })
)
