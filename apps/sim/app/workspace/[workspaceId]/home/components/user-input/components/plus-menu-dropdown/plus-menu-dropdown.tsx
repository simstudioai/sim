'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  dropdownMenuRowClass,
} from '@sim/emcn'
import { Workspaces } from '@sim/emcn/icons'
import {
  ResourceMenuSections,
  resourceFromItem,
  useAvailableResources,
  useResourceTreeSections,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import type { AvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import {
  mergeOrganizationResourceInventories,
  OrganizationResourceInventory,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/organization-resource-inventory'
import {
  byResourceMenuOrder,
  getResourceConfig,
  MENTION_PREVIEW_DEFAULT_LIMIT,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { PlusMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import {
  buildMentionPreview,
  type ResourceMentionCandidate,
  resourceMentionMatches,
  withBrowserTabMentions,
  withFolderMentions,
  withTerminalTabMentions,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useSettledTerminalCommands } from '@/hooks/use-settled-terminal-commands'
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

function isNativeResourceGroup({ type }: { type: MothershipResourceType }): boolean {
  return type === 'browser' || type === 'terminal'
}

const EMPTY_BROWSER_TABS = [] as const
const EMPTY_TERMINAL_TABS = [] as const

type PickerCandidate =
  | ResourceMentionCandidate
  | { type: 'workspace'; item: { id: string; name: string } }

interface PlusMenuDropdownProps {
  workspaceId: string
  organizationId?: string
  /**
   * Starts hydrating the resource lists before the menu opens. The editor sets
   * this on focus: `@`-mention confirmation reads the candidate list
   * synchronously on Enter, and an empty list falls through to submitting the
   * message with the mention unresolved. Focus is the earliest reliable signal
   * that a mention may be coming, and still keeps these lists off page load.
   */
  warm?: boolean
  onResourceSelect: (resource: MothershipResource) => void
  onWorkspaceSelect: (workspace: { id: string; name: string }) => void
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  pendingCursorRef: React.MutableRefObject<number | null>
  /** When in mention mode the dropdown hides its search input and uses this query for filtering. */
  mentionQuery?: string
}

export const PlusMenuDropdown = React.memo(
  React.forwardRef<PlusMenuHandle, PlusMenuDropdownProps>(function PlusMenuDropdown(
    {
      workspaceId,
      organizationId,
      warm,
      onResourceSelect,
      onWorkspaceSelect,
      onClose,
      textareaRef,
      pendingCursorRef,
      mentionQuery,
    },
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

    const inventoryEnabled = open || !!warm
    const workspaceInventory = useAvailableResources(organizationId ? '' : workspaceId, {
      enabled: inventoryEnabled,
      includeFolderMentions: true,
    })
    const { data: allWorkspaces = [], isPending: workspacesPending } = useWorkspacesQuery(
      Boolean(organizationId) && inventoryEnabled
    )
    const workspaces = allWorkspaces.filter(
      (workspace) => workspace.organizationId === organizationId
    )
    const [inventories, setInventories] = useState<Record<string, AvailableResources>>({})
    const receiveInventory = useCallback((workspaceId: string, inventory: AvailableResources) => {
      setInventories((current) =>
        current[workspaceId] === inventory ? current : { ...current, [workspaceId]: inventory }
      )
    }, [])
    const combined = organizationId
      ? mergeOrganizationResourceInventories(workspaces, inventories)
      : workspaceInventory
    const { structureFolders } = combined
    const availableResources = organizationId
      ? [...combined.groups, ...workspaceInventory.groups.filter(isNativeResourceGroup)].sort(
          byResourceMenuOrder
        )
      : combined.groups
    const isHydrating = combined.isHydrating || Boolean(organizationId && workspacesPending)

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

    const settledCommands = useSettledTerminalCommands(terminalTabs)
    const visibleResources = useMemo(() => {
      const resources = withTerminalTabMentions(
        withBrowserTabMentions(
          withFolderMentions(availableResources, structureFolders),
          browserTabs
        ),
        terminalTabs,
        settledCommands
      )
      if (isMention) return resources
      return resources.filter(({ type }) => !MENTION_ONLY_RESOURCE_TYPES.has(type))
    }, [
      availableResources,
      structureFolders,
      browserTabs,
      isMention,
      settledCommands,
      terminalTabs,
    ])

    /** Organization chat uses flat cross-workspace rows; workspace chat keeps its tree. */
    const treeSections = useResourceTreeSections({
      groups: workspaceInventory.groups,
      structureFolders: workspaceInventory.structureFolders,
      selectFolders: true,
    })

    const filteredItems = useMemo<PickerCandidate[] | null>(() => {
      const rawQuery = isMention ? (mentionQuery ?? '') : search
      const q = rawQuery.toLowerCase().trim()
      if (!isMention && !q) return null
      const workspaceMatches = organizationId
        ? workspaces
            .filter(
              (workspace) =>
                !q || workspace.name.toLowerCase().includes(q) || 'workspaces'.includes(q)
            )
            .map((workspace) => ({
              type: 'workspace' as const,
              item: { id: workspace.id, name: workspace.name },
            }))
        : []
      if (isMention && !q) {
        return [
          ...workspaceMatches.slice(0, MENTION_PREVIEW_DEFAULT_LIMIT),
          ...buildMentionPreview(
            visibleResources,
            (type) => getResourceConfig(type).mentionPreviewLimit ?? MENTION_PREVIEW_DEFAULT_LIMIT
          ),
        ]
      }
      return [
        ...workspaceMatches,
        ...visibleResources.flatMap(({ type, items }) =>
          items.filter((item) => resourceMentionMatches(item, q)).map((item) => ({ type, item }))
        ),
      ]
    }, [isMention, mentionQuery, search, visibleResources, organizationId, workspaces])

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

    const closeAfterSelect = () => {
      setOpen(false)
      setSearch('')
      setActiveIndex(0)
    }

    const handleSelect = (resource: MothershipResource) => {
      onResourceSelect(resource)
      closeAfterSelect()
    }

    const handleWorkspaceSelect = (workspace: { id: string; name: string }) => {
      onWorkspaceSelect(workspace)
      closeAfterSelect()
    }

    const handleCandidateSelect = (candidate: PickerCandidate) => {
      if (candidate.type === 'workspace') handleWorkspaceSelect(candidate.item)
      else handleSelect(resourceFromItem(candidate.type, candidate.item))
    }

    const handleSelectRef = useRef(handleCandidateSelect)
    handleSelectRef.current = handleCandidateSelect

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
          handleSelectRef.current(target)
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
        if (target) handleCandidateSelect(target)
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
      textarea.focus()
      if (pendingCursorRef.current !== null) {
        textarea.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
        pendingCursorRef.current = null
      }
    }

    // Radix's FocusScope normally focuses the content on open and traps focus inside.
    // Preventing the mount auto-focus keeps the textarea focused AND, because the focus
    // trap activates on focusin, the trap stays dormant — typing continues uninterrupted.
    const handleOpenAutoFocus = (e: Event) => {
      if (isMentionRef.current) e.preventDefault()
    }

    return (
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        {organizationId &&
          inventoryEnabled &&
          workspaces.map((workspace) => (
            <OrganizationResourceInventory
              key={workspace.id}
              workspaceId={workspace.id}
              onChange={receiveInventory}
            />
          ))}
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
              {organizationId && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Workspaces className='size-[14px]' />
                    <DropdownMenuItemLabel label='Workspaces' />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className='max-w-[min(300px,calc(100vw-32px))]'>
                    {workspaces.length ? (
                      workspaces.map((workspace) => (
                        <DropdownMenuItem
                          key={workspace.id}
                          onClick={() => handleWorkspaceSelect(workspace)}
                        >
                          <Workspaces className='size-[14px]' />
                          <DropdownMenuItemLabel label={workspace.name} />
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>
                        {workspacesPending ? 'Loading workspaces…' : 'No accessible workspaces'}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <ResourceMenuSections
                flat={Boolean(organizationId)}
                combineFileFolders={Boolean(organizationId)}
                sections={organizationId ? [] : treeSections}
                groups={visibleResources}
                onSelect={handleSelect}
                subContentClassName='max-w-[min(300px,calc(100vw-32px))]'
              />
            </div>
            {/* Plain buttons, not DropdownMenuItem: mount/unmount must not mutate Radix's
                  menu Collection, or FocusScope restores focus to the content root. */}
            {filteredItems !== null &&
              (filteredItems.length > 0 ? (
                filteredItems.map((candidate, index) => {
                  const { type, item } = candidate
                  const config = type === 'workspace' ? null : getResourceConfig(type)
                  const isActive = index === activeIndex
                  const sectionLabel =
                    type === 'workspace'
                      ? 'Workspaces'
                      : organizationId && type === 'filefolder'
                        ? 'Files'
                        : (config?.label ?? 'Workspaces')
                  const previous = filteredItems[index - 1]
                  const previousSection = previous
                    ? previous.type === 'workspace'
                      ? 'Workspaces'
                      : organizationId && previous.type === 'filefolder'
                        ? 'Files'
                        : getResourceConfig(previous.type).label
                    : null
                  const startsSection = sectionLabel !== previousSection
                  return (
                    <React.Fragment
                      key={`${type}:${'workspaceId' in item ? item.workspaceId : ''}:${item.id}`}
                    >
                      {startsSection && <DropdownMenuLabel>{sectionLabel}</DropdownMenuLabel>}
                      <button
                        type='button'
                        role='menuitem'
                        data-filtered-idx={index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          handleCandidateSelect(candidate)
                        }}
                        className={cn(
                          dropdownMenuRowClass,
                          'w-full text-left',
                          /* `activeIndex` is the cursor, not a selection — hover surface. */
                          isActive && 'bg-[var(--surface-hover)]'
                        )}
                      >
                        {config ? (
                          config.renderDropdownItem({ item })
                        ) : (
                          <>
                            <Workspaces className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                            <span className='truncate'>{item.name}</span>
                          </>
                        )}
                        {'workspaceName' in item && typeof item.workspaceName === 'string' && (
                          <span className='ml-auto text-[var(--text-muted)] text-xs'>
                            {item.workspaceName}
                          </span>
                        )}
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
