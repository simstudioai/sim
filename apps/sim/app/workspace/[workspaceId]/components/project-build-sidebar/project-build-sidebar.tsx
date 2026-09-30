'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  Chip,
  ChipLink,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import {
  Building,
  Check,
  ChevronDown,
  ChevronLeft,
  PanelLeft,
  Plus,
  Search,
  Server,
  SquarePen,
} from '@sim/emcn/icons'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { canViewWorkspaceBillingSettings } from '@/lib/billing/workspace-permissions'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isStatusNoticePreviewEnabled } from '@/lib/core/config/env-flags'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { captureEvent } from '@/lib/posthog/client'
import { parseEnvironmentName, resolveProjectLineages } from '@/lib/projects'
import {
  BUILD_NAV_SECTIONS,
  PROJECT_NAV_SECTIONS,
  projectHomeHref,
} from '@/app/workspace/[workspaceId]/components/project-build-sidebar/constants'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import {
  allNavigationItems,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  ChatNavigationLink,
  isNavItemActive,
  SettingsSidebar,
  SidebarFooter,
  SidebarNavChip,
  type SidebarNavItemData,
  SidebarSection,
  SidebarTooltip,
  StatusNotice,
  WorkspaceSidebarModals,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSidebarResize } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  type SidebarChat,
  useWorkspaceSidebarServices,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/use-workspace-sidebar-services'
import { useWorkspaceAccessRequestFeatures } from '@/ee/access-requests/components/permission-access-boundary'
import { useUserProfile } from '@/hooks/queries/user-profile'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSidebarStore } from '@/stores/sidebar/store'

/** How many chats show before "See more", matching the workspace sidebar. */
const CHAT_PREVIEW_COUNT = 5

/**
 * Opts a control out of the desktop shell's window-drag region. The header row is
 * draggable chrome, so anything clickable inside it has to say so or the click is
 * swallowed by the drag handler.
 */
const DRAG_EXEMPT_CLASS = '[-webkit-app-region:no-drag]'

interface ProjectBuildSidebarProps {
  organizationHref: string | null
}

/**
 * The workspace rail while the org project view is on: the project's Build view.
 *
 * Same chrome as the workspace `Sidebar` (collapse, peek, resize, footer, settings
 * sub-navigation) and the same invisible services underneath it through
 * {@link useWorkspaceSidebarServices}, but the rail lists the project instead of the
 * workspace: a back chip to the project main view, the environment the workspace plays in
 * its fork lineage, the main view's sections, the flat Build sections, and the chats. No
 * resource trees: every Build page owns its own folder tree in the content area.
 */
export const ProjectBuildSidebar = memo(function ProjectBuildSidebar({
  organizationHref,
}: ProjectBuildSidebarProps) {
  const { isCollapsed: isCollapsedProp, isPeeking } = useSidebarChrome()
  const isCollapsed = isCollapsedProp && !isPeeking
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string | undefined
  const router = useRouter()
  const pathname = usePathname()

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)

  const posthog = usePostHog()
  const { data: profile } = useUserProfile()
  const hostContext = useWorkspaceHostContext()
  const { hosted } = useDeploymentShape()
  const { config: permissionConfig } = usePermissionConfig()
  const accessRequests = useWorkspaceAccessRequestFeatures()
  const accessRequestsEnabled = accessRequests.data?.enabled === true
  const { getSettingsHref, navigateToSettings } = useSettingsNavigation()
  const openSearchModal = useSearchModalStore((state) => state.open)
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const { data: workspaces } = useWorkspacesQuery()

  const services = useWorkspaceSidebarServices({ workspaceId, workflowId })
  const { chats, chatsLoading, chatsEnabled } = services

  const { handlePointerDown } = useSidebarResize()
  const [visibleChatCount, setVisibleChatCount] = useState(CHAT_PREVIEW_COUNT)

  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })

  const isMac = isMacPlatform()
  const showCollapsedTooltips = isCollapsed
  const isOnSettingsPage = pathname?.startsWith(`/workspace/${workspaceId}/settings`) ?? false

  /**
   * The project this workspace belongs to. Until the workspace list arrives the route's own
   * workspace stands in as a one-environment project, so the header never renders blank.
   */
  const project = useMemo(() => {
    const lineage = workspaces ? resolveProjectLineages(workspaces).get(workspaceId) : undefined
    if (lineage) {
      const root = workspaces?.find((workspace) => workspace.id === lineage.rootId)
      return { ...lineage, logoUrl: root?.logoUrl ?? null }
    }
    const { base, environment } = parseEnvironmentName(hostContext.workspace.name)
    return {
      name: base,
      environment: environment ?? 'Prod',
      environments: [{ workspaceId, label: environment ?? 'Prod' }],
      logoUrl: null,
    }
  }, [workspaces, workspaceId, hostContext.workspace.name])

  /** The page the viewer is on, relative to the workspace, so a switch lands on its peer. */
  const workspaceSubPath = useMemo(() => {
    const base = `/workspace/${workspaceId}`
    return pathname?.startsWith(base) ? pathname.slice(base.length) : ''
  }, [pathname, workspaceId])

  const projectNavItems = useMemo(
    (): SidebarNavItemData[] =>
      PROJECT_NAV_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        icon: section.icon,
        href: projectHomeHref(workspaceId, section.id),
      })),
    [workspaceId]
  )

  const buildNavItems = useMemo(() => {
    const base = `/workspace/${workspaceId}`
    const hiddenBySection: Partial<Record<string, boolean>> = {
      integrations: permissionConfig.hideIntegrationsTab,
      files: permissionConfig.hideFilesTab,
      tables: permissionConfig.hideTablesTab,
      knowledge: permissionConfig.hideKnowledgeBaseTab,
    }
    return BUILD_NAV_SECTIONS.map((section): SidebarNavItemData & { hidden: boolean } => {
      const restricted = hiddenBySection[section.id] === true
      return {
        id: section.id,
        label: section.label,
        icon: section.icon,
        href: `${base}/${section.segment}`,
        additionalActivePaths: section.activeSegments?.map((segment) => `${base}/${segment}`),
        restricted,
        hidden: restricted && !accessRequestsEnabled,
      }
    }).filter((item) => !item.hidden)
  }, [
    workspaceId,
    permissionConfig.hideIntegrationsTab,
    permissionConfig.hideFilesTab,
    permissionConfig.hideTablesTab,
    permissionConfig.hideKnowledgeBaseTab,
    accessRequestsEnabled,
  ])

  const newChatItem = useMemo(
    (): SidebarNavItemData => ({
      id: 'new-chat',
      label: 'New chat',
      icon: SquarePen,
      href: `/workspace/${workspaceId}/home`,
      restricted: permissionConfig.hideCopilot,
    }),
    [workspaceId, permissionConfig.hideCopilot]
  )

  const handleOpenSettings = (section: SettingsSection) => {
    navigateToSettings({ section })
  }

  const profileNavigationLinks = allNavigationItems
    .filter(
      ({ id }) =>
        id === 'teammates' ||
        id === 'recently-deleted' ||
        (id === 'billing' && canViewWorkspaceBillingSettings(hostContext, profile?.id))
    )
    .map(({ id, label, icon }) => ({
      label,
      icon,
      href: getSettingsHref({ section: id }),
      onNavigate: () => handleOpenSettings(id),
    }))

  if (organizationHref) {
    profileNavigationLinks.push({
      label: 'Organization',
      icon: Building,
      href: organizationHref,
      onNavigate: () => router.push(organizationHref),
    })
  }

  const handleSwitchEnvironment = useCallback(
    (targetWorkspaceId: string) => {
      if (targetWorkspaceId === workspaceId) return
      router.push(`/workspace/${targetWorkspaceId}${workspaceSubPath}`)
    },
    [router, workspaceId, workspaceSubPath]
  )

  const handleSeeMoreChats = useCallback(
    () => setVisibleChatCount((prev) => prev + CHAT_PREVIEW_COUNT),
    []
  )
  const handleSeeLessChats = useCallback(() => setVisibleChatCount(CHAT_PREVIEW_COUNT), [])

  const handleEdgeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCollapsed && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        toggleCollapsed()
      }
    },
    [isCollapsed, toggleCollapsed]
  )

  const handleOpenDocs = () => {
    window.open(DOCS_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
  }

  const handleOpenSlackCommunity = () => {
    window.open(SLACK_COMMUNITY_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'slack_community_opened', { source: 'help_menu' })
  }

  const environmentChip = (
    <Chip
      fullWidth
      leftIcon={Server}
      rightIcon={isCollapsed ? undefined : ChevronDown}
      aria-label='Switch environment'
      className={SIDEBAR_RAIL_CHIP_CLASS}
    >
      <span className='sidebar-collapse-hide'>{project.environment}</span>
    </Chip>
  )

  return (
    <>
      <div className='relative h-full'>
        <aside
          className='group/rail sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)] [&_.group.cursor-pointer]:duration-0'
          data-collapsed={isCollapsed || undefined}
          aria-label='Project sidebar'
        >
          <div className='flex h-full flex-col'>
            {/* The peek card already sits below the lane; reserving it again doubles the offset. */}
            {!isPeeking && (
              <div
                aria-hidden
                className='desktop-window-drag-region desktop-workspace-window-drag-region h-[var(--desktop-title-bar-height)]'
              />
            )}
            <div
              className={cn(
                'relative flex shrink-0 items-center gap-[1px] px-2 pt-2',
                !isPeeking &&
                  '[[data-sim-desktop-title-bar=inset]_&]:pt-[var(--desktop-title-bar-height)]'
              )}
            >
              <div className='min-w-0 flex-1'>
                <SidebarTooltip label={`Back to ${project.name}`} enabled side='bottom'>
                  <ChipLink
                    href={projectHomeHref(workspaceId)}
                    fullWidth
                    className={cn(SIDEBAR_RAIL_CHIP_CLASS, DRAG_EXEMPT_CLASS)}
                    leftAdornment={
                      <span className='flex shrink-0 items-center gap-1'>
                        <ChevronLeft className='size-[14px] text-[var(--text-icon)]' />
                        <IdentityTile initial={project.name[0] ?? '?'} logoUrl={project.logoUrl} />
                      </span>
                    }
                  >
                    <span className='sidebar-collapse-hide'>{project.name}</span>
                  </ChipLink>
                </SidebarTooltip>
              </div>
              {/* Same cluster as the workspace sidebar's header: see the note there. */}
              <div
                inert={isCollapsed}
                className={cn(
                  'flex h-[30px] items-center gap-[1px] overflow-hidden',
                  isCollapsed
                    ? 'w-0 opacity-0'
                    : 'w-[65px] [[data-sim-desktop-title-bar=inset]_&]:w-[32px]'
                )}
              >
                <SidebarTooltip
                  label='Search'
                  enabled={!isCollapsed}
                  side='bottom'
                  shortcut={isMac ? '⌘K' : 'Ctrl+K'}
                >
                  <Chip
                    leftIcon={Search}
                    aria-label='Search'
                    /* Called with no args — the store setter's first parameter is an
                       options object, which a raw handler would fill with the event. */
                    onClick={() => openSearchModal()}
                    tabIndex={isCollapsed ? -1 : undefined}
                    className={DRAG_EXEMPT_CLASS}
                  />
                </SidebarTooltip>
                <SidebarTooltip
                  label='Collapse sidebar'
                  enabled={!isCollapsed}
                  side='bottom'
                  shortcut={isMac ? '⌘B' : 'Ctrl+B'}
                >
                  <Chip
                    leftIcon={PanelLeft}
                    aria-label='Collapse sidebar'
                    onClick={toggleCollapsed}
                    tabIndex={isCollapsed ? -1 : undefined}
                    className={cn(
                      DRAG_EXEMPT_CLASS,
                      '[[data-sim-desktop-title-bar=inset]_&]:hidden'
                    )}
                  />
                </SidebarTooltip>
              </div>
            </div>

            {isOnSettingsPage ? (
              <SettingsSidebar
                isCollapsed={isCollapsed}
                showCollapsedTooltips={showCollapsedTooltips}
              />
            ) : (
              <>
                {/* The divider is the pinned block's bottom rule, not the scroll region's top one:
                    the region's edge fade masks its own first pixels, which would erase a rule
                    drawn there exactly when it should show. Same construction as the footer. */}
                <div
                  className={cn(
                    SIDEBAR_SECTION_GAP_CLASS,
                    SIDEBAR_ITEM_GAP_CLASS,
                    SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
                    'flex shrink-0 flex-col border-b px-2 transition-colors duration-150',
                    !scrollEdges.top && 'border-transparent'
                  )}
                >
                  <SidebarTooltip
                    label={`Environment: ${project.environment}`}
                    enabled={showCollapsedTooltips}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>{environmentChip}</DropdownMenuTrigger>
                      <DropdownMenuContent align='start' sideOffset={4} className='min-w-[180px]'>
                        {project.environments.map((environment) => {
                          const isCurrent = environment.workspaceId === workspaceId
                          return (
                            <DropdownMenuItem
                              key={environment.workspaceId}
                              onSelect={() => handleSwitchEnvironment(environment.workspaceId)}
                              aria-current={isCurrent ? 'true' : undefined}
                            >
                              <Server />
                              {environment.label}
                              {isCurrent && <Check className='ml-auto size-[14px]' />}
                            </DropdownMenuItem>
                          )
                        })}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => router.push(projectHomeHref(workspaceId, 'environments'))}
                        >
                          <Plus />
                          Manage environments
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarTooltip>
                </div>

                <div
                  ref={isCollapsed ? undefined : scrollContainerRef}
                  className={cn(
                    SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
                    SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
                    scrollFadeClass,
                    'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden'
                  )}
                  {...scrollFadeAttributes(scrollEdges)}
                >
                  <div ref={scrollContentRef} className='flex flex-col'>
                    <SidebarSection
                      title='Project'
                      railCollapsed={isCollapsed}
                      className='shrink-0'
                    >
                      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                        {projectNavItems.map((item) => (
                          <SidebarTooltip
                            key={item.id}
                            label={item.label}
                            enabled={showCollapsedTooltips}
                          >
                            <SidebarNavChip item={item} active={isNavItemActive(item, pathname)} />
                          </SidebarTooltip>
                        ))}
                      </div>
                    </SidebarSection>

                    <SidebarSection
                      title='Build'
                      railCollapsed={isCollapsed}
                      className={cn(SIDEBAR_SECTION_GAP_CLASS, 'shrink-0')}
                    >
                      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                        {buildNavItems.map((item) => (
                          <SidebarTooltip
                            key={item.id}
                            label={item.label}
                            enabled={showCollapsedTooltips}
                          >
                            <SidebarNavChip item={item} active={isNavItemActive(item, pathname)} />
                          </SidebarTooltip>
                        ))}
                      </div>
                    </SidebarSection>

                    {chatsEnabled && (
                      <SidebarSection
                        title='Chats'
                        railCollapsed={isCollapsed}
                        className={cn(SIDEBAR_SECTION_GAP_CLASS, 'shrink-0')}
                      >
                        <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                          <SidebarTooltip label={newChatItem.label} enabled={showCollapsedTooltips}>
                            <SidebarNavChip
                              item={newChatItem}
                              active={isNavItemActive(newChatItem, pathname)}
                            />
                          </SidebarTooltip>
                          {!chatsLoading && (
                            <>
                              {chats.slice(0, visibleChatCount).map((chat) => (
                                <ProjectChatItem
                                  key={chat.id}
                                  chat={chat}
                                  isCurrentRoute={pathname === chat.href}
                                  showCollapsedTooltips={showCollapsedTooltips}
                                />
                              ))}
                              {chats.length > CHAT_PREVIEW_COUNT && (
                                <button
                                  type='button'
                                  onClick={
                                    chats.length > visibleChatCount
                                      ? handleSeeMoreChats
                                      : handleSeeLessChats
                                  }
                                  className={cn(
                                    chipVariants({ fullWidth: true }),
                                    'sidebar-collapse-hide text-[var(--text-muted)] text-small'
                                  )}
                                >
                                  {chats.length > visibleChatCount ? 'See more' : 'See less'}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </SidebarSection>
                    )}
                  </div>
                </div>

                {(hosted || isStatusNoticePreviewEnabled) && !isCollapsed ? (
                  <StatusNotice preview={isStatusNoticePreviewEnabled} />
                ) : null}

                <SidebarFooter
                  showDivider={scrollEdges.bottom}
                  isCollapsed={isCollapsed}
                  showCollapsedTooltips={showCollapsedTooltips}
                  accountSettingsHref={getSettingsHref({ section: 'general' })}
                  onOpenAccountSettings={() => handleOpenSettings('general')}
                  navigationLinks={profileNavigationLinks}
                  onOpenDocs={handleOpenDocs}
                  onJoinSlack={handleOpenSlackCommunity}
                  onContactSupport={services.openHelpModal}
                />
              </>
            )}
          </div>
        </aside>

        {/* Not on the peek card: the resize hook writes an inline `--sidebar-width` that
            out-specifies the `[data-peek]` rule, stranding the card at a stale width. */}
        {!isPeeking && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-20 w-[8px] translate-x-1/2',
              isCollapsed ? 'cursor-e-resize' : 'cursor-ew-resize'
            )}
            onPointerDown={isCollapsed ? undefined : handlePointerDown}
            onClick={isCollapsed ? toggleCollapsed : undefined}
            onKeyDown={handleEdgeKeyDown}
            role={isCollapsed ? 'button' : 'separator'}
            tabIndex={0}
            aria-orientation={isCollapsed ? undefined : 'vertical'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Resize sidebar'}
          />
        )}
      </div>

      <WorkspaceSidebarModals services={services} />
    </>
  )
})

interface ProjectChatItemProps {
  chat: SidebarChat
  isCurrentRoute: boolean
  showCollapsedTooltips: boolean
}

/** One chat row: the same link and prefetch behavior as the workspace sidebar's chats. */
const ProjectChatItem = memo(function ProjectChatItem({
  chat,
  isCurrentRoute,
  showCollapsedTooltips,
}: ProjectChatItemProps) {
  const showStatusDot = chat.isActive || (!isCurrentRoute && chat.isUnread)
  return (
    <SidebarTooltip label={chat.name} enabled={showCollapsedTooltips}>
      <ChatNavigationLink
        chatId={chat.id}
        href={chat.href}
        isCurrentRoute={isCurrentRoute}
        className={cn(
          chipVariants({ active: isCurrentRoute, fullWidth: true }),
          SIDEBAR_RAIL_CHIP_CLASS
        )}
      >
        <OverflowText
          label={chat.name}
          className='sidebar-collapse-hide flex-1 text-[var(--text-body)]'
        />
        {showStatusDot && (
          <span
            aria-hidden='true'
            className='sidebar-collapse-hide size-[6px] shrink-0 rounded-full'
            style={{ backgroundColor: chat.isActive ? '#EAB308' : 'var(--brand-accent)' }}
          />
        )}
      </ChatNavigationLink>
    </SidebarTooltip>
  )
})
