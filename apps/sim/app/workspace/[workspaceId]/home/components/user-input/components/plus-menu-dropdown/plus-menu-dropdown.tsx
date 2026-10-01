'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItemLabel,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
  dropdownMenuRowClass,
  OverflowText,
} from '@sim/emcn'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import {
  ResourceMenuSections,
  resourceFromItem,
  useAvailableResources,
  useResourceTreeSections,
  WorkspaceResourceSubmenu,
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
import { useOrderedWorkspacesQuery, type Workspace } from '@/hooks/queries/workspace'
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
const RESOURCE_MENU_WIDTH_CLASS = 'w-[360px] min-w-0 max-w-[min(360px,calc(100vw-16px))]'

type MentionCandidate =
  | ResourceMentionCandidate
  | { type: 'workspace'; item: Pick<Workspace, 'id' | 'name' | 'logoUrl'> }

function candidateKey({ type, item }: MentionCandidate): string {
  return `${type}:${'workspaceId' in item ? item.workspaceId : ''}:${item.id}`
}

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

/**
 * Families an organization chat's workspace submenus leave out: the mention-only
 * ones, plus Browser and Terminal, which belong to this desktop rather than to a
 * workspace and so sit once after the workspaces.
 */
const WORKSPACE_SUBMENU_EXCLUDED_TYPES: readonly MothershipResourceType[] = [
  ...MENTION_ONLY_RESOURCE_TYPES,
  'browser',
  'terminal',
]

function isNativeResourceGroup({ type }: { type: MothershipResourceType }): boolean {
  return type === 'browser' || type === 'terminal'
}

const EMPTY_BROWSER_TABS = [] as const
const EMPTY_TERMINAL_TABS = [] as const

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
  /** Tags a whole workspace; offered only in organization chats. */
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
    const [activeItem, setActiveItem] = useState<{ query: string; key: string } | null>(null)
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
    const { data: allWorkspaces, isPending: workspacesPending } = useOrderedWorkspacesQuery(
      Boolean(organizationId) && inventoryEnabled
    )
    const workspaces = useMemo(
      () =>
        organizationId
          ? (allWorkspaces ?? []).filter((workspace) => workspace.organizationId === organizationId)
          : [],
      [allWorkspaces, organizationId]
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
        setActiveItem(null)
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

    /**
     * Built from this workspace's own inventory, which has no foldered families in an
     * organization chat: there each workspace submenu builds its own sections, because
     * ids are only unique within a workspace.
     */
    const treeSections = useResourceTreeSections({
      groups: workspaceInventory.groups,
      structureFolders: workspaceInventory.structureFolders,
      selectFolders: true,
    })

    const query = isMention ? (mentionQuery ?? '') : search
    const filteredItems = useMemo((): MentionCandidate[] | null => {
      const q = query.toLowerCase().trim()
      if (!isMention && !q) return null
      const workspaceItems: MentionCandidate[] = (
        q ? workspaces : workspaces.slice(0, MENTION_PREVIEW_DEFAULT_LIMIT)
      )
        .filter((workspace) => workspace.name.toLowerCase().includes(q))
        .map((item) => ({ type: 'workspace', item }))
      const resourceItems = q
        ? visibleResources.flatMap(({ type, items }) =>
            items.filter((item) => resourceMentionMatches(item, q)).map((item) => ({ type, item }))
          )
        : buildMentionPreview(
            visibleResources,
            (type) => getResourceConfig(type).mentionPreviewLimit ?? MENTION_PREVIEW_DEFAULT_LIMIT
          )
      return [...workspaceItems, ...resourceItems]
    }, [isMention, query, visibleResources, workspaces])

    const activeIndex = Math.max(
      0,
      filteredItems?.findIndex(
        (candidate) => activeItem?.query === query && candidateKey(candidate) === activeItem.key
      ) ?? -1
    )
    const activeKey = filteredItems?.[activeIndex] ? candidateKey(filteredItems[activeIndex]) : null
    if (activeKey !== null && (activeItem?.query !== query || activeItem.key !== activeKey)) {
      setActiveItem({ query, key: activeKey })
    } else if (activeItem !== null && activeItem.query !== query) {
      setActiveItem(null)
    }

    const highlightIndex = (index: number) => {
      const candidate = filteredItems?.[index]
      if (candidate) setActiveItem({ query, key: candidateKey(candidate) })
    }
    const highlightIndexRef = useRef(highlightIndex)
    highlightIndexRef.current = highlightIndex

    const filteredItemsRef = useRef(filteredItems)
    filteredItemsRef.current = filteredItems
    const activeIndexRef = useRef(activeIndex)
    activeIndexRef.current = activeIndex
    const isMentionRef = useRef(isMention)
    isMentionRef.current = isMention
    const isHydratingRef = useRef(isHydrating)
    isHydratingRef.current = isHydrating

    const closeAfterSelect = () => {
      setOpen(false)
      setSearch('')
      setActiveItem(null)
    }

    const handleSelect = (resource: MothershipResource) => {
      onResourceSelect(resource)
      closeAfterSelect()
    }

    const handleWorkspaceSelect = (workspace: { id: string; name: string }) => {
      onWorkspaceSelect(workspace)
      closeAfterSelect()
    }

    const handleCandidateSelect = (candidate: MentionCandidate) => {
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
          const next = activeIndexRef.current + delta
          highlightIndexRef.current(next < 0 ? items.length - 1 : next >= items.length ? 0 : next)
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
        highlightIndex(Math.min(activeIndex + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        highlightIndex(Math.max(activeIndex - 1, 0))
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
        setActiveItem(null)
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
            RESOURCE_MENU_WIDTH_CLASS,
            isMention && MENTION_MAX_HEIGHT_CLASS
          )}
          onCloseAutoFocus={handleCloseAutoFocus}
          onOpenAutoFocus={handleOpenAutoFocus}
          onKeyDown={handleContentKeyDown}
        >
          {!isMention && (
            <DropdownMenuSearchInput
              ref={searchRef}
              placeholder='Search resources'
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
              }}
              onKeyDown={handleSearchKeyDown}
            />
          )}
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-none'>
            {/* Always-mounted; swapping this subtree with filtered results makes Radix's
                  menu FocusScope steal focus from the search input back to the content root. */}
            <div hidden={filteredItems !== null}>
              {organizationId &&
                workspaces.map((workspace) => (
                  <WorkspaceResourceSubmenu
                    key={workspace.id}
                    workspace={workspace}
                    excludeTypes={WORKSPACE_SUBMENU_EXCLUDED_TYPES}
                    selectFolders
                    onSelect={handleSelect}
                    onSelectWorkspace={handleWorkspaceSelect}
                    subContentClassName={RESOURCE_MENU_WIDTH_CLASS}
                  />
                ))}
              <ResourceMenuSections
                sections={treeSections}
                groups={
                  organizationId ? visibleResources.filter(isNativeResourceGroup) : visibleResources
                }
                onSelect={handleSelect}
                subContentClassName={RESOURCE_MENU_WIDTH_CLASS}
              />
            </div>
            {/* Plain buttons, not DropdownMenuItem: mount/unmount must not mutate Radix's
                  menu Collection, or FocusScope restores focus to the content root. */}
            {filteredItems !== null &&
              (filteredItems.length > 0 ? (
                filteredItems.map((candidate, index) => {
                  const { type, item } = candidate
                  const config = type === 'workspace' ? null : getResourceConfig(type)
                  const workspaceName = 'workspaceName' in item ? item.workspaceName : undefined
                  const isActive = index === activeIndex
                  /* Items arrive grouped by family (one group per type, ordered by
                     RESOURCE_MENU_ORDER), so a type change marks a section boundary.
                     Deriving the heading from the flat list keeps `activeIndex` — and
                     therefore every keyboard path — indexing exactly what it did. */
                  const startsSection = index === 0 || filteredItems[index - 1]?.type !== type
                  return (
                    <React.Fragment key={candidateKey(candidate)}>
                      {startsSection && (
                        <DropdownMenuLabel>{config?.label ?? 'Workspaces'}</DropdownMenuLabel>
                      )}
                      <button
                        type='button'
                        role='menuitem'
                        data-filtered-idx={index}
                        onMouseEnter={() => highlightIndex(index)}
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
                        {candidate.type === 'workspace' ? (
                          <>
                            <IdentityTile
                              initial={getWorkspaceInitial(candidate.item.name)}
                              logoUrl={candidate.item.logoUrl}
                            />
                            <DropdownMenuItemLabel label={candidate.item.name} />
                          </>
                        ) : (
                          getResourceConfig(candidate.type).renderDropdownItem({
                            item: candidate.item,
                          })
                        )}
                        {typeof workspaceName === 'string' && (
                          <OverflowText
                            label={workspaceName}
                            className='ml-auto max-w-[35%] shrink-0 text-[var(--text-muted)] text-xs'
                          />
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
