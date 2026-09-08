'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
  dropdownMenuRowClass,
} from '@sim/emcn'
import {
  ResourceMenuSections,
  resourceFromItem,
  useAvailableResources,
  useResourceTreeSections,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import {
  getResourceConfig,
  MENTION_PREVIEW_DEFAULT_LIMIT,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import {
  buildMentionPreview,
  resourceMentionMatches,
  withDesktopTabMentions,
  withFolderMentions,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

/**
 * The `@` list is shorter than the emcn menu default (420px, sized for right-click
 * action menus). This one floats directly over the chat input, so a menu tall enough
 * to swallow the conversation behind it reads as a takeover rather than an
 * autocomplete. ~10 rows is enough to show several families at once.
 */
const MENTION_MAX_HEIGHT_CLASS = 'max-h-[min(280px,var(--radix-popper-available-height,280px))]'

/**
 * Resource types that are only offered via `@`-mention autocomplete and hidden
 * from the `+` browse menu. Integrations are searchable inline (e.g. typing
 * `@sla` surfaces Slack) but should not clutter the explicit attach menu.
 *
 * Filtered here rather than via the hook's `excludeTypes` because the exclusion
 * is mode-dependent (`isMention`) — one fetch serves both modes. The resource
 * tab bar, whose exclusion is static, uses `excludeTypes` instead
 * (`ADD_RESOURCE_EXCLUDED_TYPES` in `resource-tabs`).
 */
const MENTION_ONLY_RESOURCE_TYPES = new Set<MothershipResourceType>(['integration'])
const EMPTY_BROWSER_TABS = [] as const
const EMPTY_TERMINAL_TABS = [] as const

interface PlusMenuDropdownProps {
  workspaceId: string
  /**
   * Starts hydrating the resource lists before the menu opens. The editor sets
   * this on focus: `@`-mention confirmation reads the candidate list
   * synchronously on Enter, and an empty list falls through to submitting the
   * message with the mention unresolved. Focus is the earliest reliable signal
   * that a mention may be coming, and still keeps these lists off page load.
   */
  warm?: boolean
  onResourceSelect: (resource: MothershipResource) => void
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pendingCursorRef: React.MutableRefObject<number | null>
  /** When in mention mode the dropdown hides its search input and uses this query for filtering. */
  mentionQuery?: string
}

export const PlusMenuDropdown = React.memo(
  React.forwardRef<PlusMenuHandle, PlusMenuDropdownProps>(function PlusMenuDropdown(
    { workspaceId, warm, onResourceSelect, onClose, textareaRef, pendingCursorRef, mentionQuery },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [isMention, setIsMention] = useState(false)
    const [search, setSearch] = useState('')
    const [anchorPos, setAnchorPos] = useState<{ left: number; top: number } | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const searchRef = useRef<HTMLInputElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const browserTabs = useBrowserSessionStore((state) => {
      const scopeId = state.activeScopeId
      return scopeId ? (state.sessions[scopeId]?.tabs ?? EMPTY_BROWSER_TABS) : EMPTY_BROWSER_TABS
    })
    const terminalTabs = useCopilotTerminalStore((state) => {
      const scopeId = state.activeScopeId
      return scopeId
        ? (state.sessions[scopeId]?.tabs.tabs ?? EMPTY_TERMINAL_TABS)
        : EMPTY_TERMINAL_TABS
    })

    // Gated so an idle chat surface never fetches the workspace lists.
    const {
      groups: availableResources,
      structureFolders,
      isHydrating,
    } = useAvailableResources(workspaceId, {
      enabled: open || !!warm,
      includeFolderMentions: true,
    })

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

    const visibleResources = useMemo(() => {
      const resources = withFolderMentions(availableResources, structureFolders)
      if (isMention) {
        return withDesktopTabMentions(resources, browserTabs, terminalTabs)
      }
      return resources.filter(({ type }) => !MENTION_ONLY_RESOURCE_TYPES.has(type))
    }, [availableResources, structureFolders, browserTabs, isMention, terminalTabs])

    const treeSections = useResourceTreeSections({
      groups: availableResources,
      structureFolders,
      selectFolders: true,
    })

    const filteredItems = useMemo(() => {
      const rawQuery = isMention ? (mentionQuery ?? '') : search
      const q = rawQuery.toLowerCase().trim()
      if (!isMention && !q) return null
      if (isMention && !q) {
        return buildMentionPreview(
          visibleResources,
          (type) => getResourceConfig(type).mentionPreviewLimit ?? MENTION_PREVIEW_DEFAULT_LIMIT
        )
      }
      return visibleResources.flatMap(({ type, items }) =>
        items.filter((item) => resourceMentionMatches(item, q)).map((item) => ({ type, item }))
      )
    }, [isMention, mentionQuery, search, visibleResources])

    const filteredItemsRef = useRef(filteredItems)
    filteredItemsRef.current = filteredItems
    const activeIndexRef = useRef(activeIndex)
    activeIndexRef.current = activeIndex
    const isMentionRef = useRef(isMention)
    isMentionRef.current = isMention
    const isHydratingRef = useRef(isHydrating)
    isHydratingRef.current = isHydrating

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
          const target = items?.length ? (items[activeIndexRef.current] ?? items[0]) : undefined
          if (!target) return isHydratingRef.current ? 'hydrating' : 'empty'
          handleSelectRef.current(resourceFromItem(target.type, target.item))
          return 'selected'
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
        if (target) handleSelect(resourceFromItem(target.type, target.item))
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
            className='pointer-events-none fixed size-0'
            style={{ left: anchorPos?.left ?? 0, top: anchorPos?.top ?? 0 }}
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
            isMention && `max-w-[min(300px,calc(100vw-32px))] ${MENTION_MAX_HEIGHT_CLASS}`
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
              <ResourceMenuSections
                sections={treeSections}
                groups={visibleResources}
                onSelect={handleSelect}
                subContentClassName='max-w-[min(300px,calc(100vw-32px))]'
              />
            </div>
            {/* Plain buttons, not DropdownMenuItem: mount/unmount must not mutate Radix's
                  menu Collection, or FocusScope restores focus to the content root. */}
            {filteredItems !== null &&
              (filteredItems.length > 0 ? (
                filteredItems.map(({ type, item }, index) => {
                  const config = getResourceConfig(type)
                  const isActive = index === activeIndex
                  /* Items arrive grouped by family (one group per type, ordered by
                     RESOURCE_MENU_ORDER), so a type change marks a section boundary.
                     Deriving the heading from the flat list keeps `activeIndex` — and
                     therefore every keyboard path — indexing exactly what it did. */
                  const startsSection = index === 0 || filteredItems[index - 1]?.type !== type
                  return (
                    <React.Fragment key={`${type}:${item.id}`}>
                      {startsSection && <DropdownMenuLabel>{config.label}</DropdownMenuLabel>}
                      <button
                        type='button'
                        role='menuitem'
                        data-filtered-idx={index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          handleSelect(resourceFromItem(type, item))
                        }}
                        className={cn(
                          dropdownMenuRowClass,
                          'w-full text-left',
                          /* `activeIndex` is the cursor, not a selection — hover surface. */
                          isActive && 'bg-[var(--surface-hover)]'
                        )}
                      >
                        {config.renderDropdownItem({ item })}
                      </button>
                    </React.Fragment>
                  )
                })
              ) : (
                <div className='flex h-[28px] items-center justify-center px-2 text-[var(--text-muted)] text-caption'>
                  No results
                </div>
              ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  })
)
