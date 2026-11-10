import { useMemo } from 'react'
import type { Workspace, WorkspaceCreationPolicy } from '@/lib/api/contracts'
import type { UserProfile } from '@/hooks/queries/current-user-data'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import type { MothershipChatMetadata } from '@/hooks/queries/mothership-chats'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useUserProfile } from '@/hooks/queries/user-profile'
import {
  useOrderedWorkspacesQuery,
  usePinnedWorkspaceIds,
  useWorkspaceCreationPolicy,
} from '@/hooks/queries/workspace'
import { useCanOpenOrganizationChat, useChatListActions } from '@/platform/lib/data/chat-list'
import type {
  ShellActions,
  ShellChat,
  ShellData,
  ShellWorkspace,
} from '@/platform/lib/data/models/shell'
import { useNavWarmers } from '@/platform/lib/data/nav-warmers'
import { useOrganization } from '@/platform/lib/data/organization'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'
import { useLiveAccountActions } from '@/platform/lib/data/shell-actions'
import type { LiveShell } from '@/platform/lib/data/shell-context'
import { useWorkspaceActions } from '@/platform/lib/data/workspaces'
import { workspaceHomePath } from '@/platform/lib/workspace-navigation'
import type { ShellDestination } from '@/platform/shared/shell'

/** The legacy sidebar's page size for its Workspaces section, which the Chats section shares. */
const SIDEBAR_PAGE_SIZE = 5

/** A workspace opens in the zone, on the page its live data serves first. */
const liveWorkspaceHome = (workspaceId: string) => workspaceHomePath(workspaceId, 'live')

function toShellWorkspace(
  workspace: Workspace,
  pinnedIds: ReadonlySet<string> | undefined,
  viewerId: string | undefined
): ShellWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    href: liveWorkspaceHome(workspace.id),
    permissions: workspace.permissions,
    isPinned: pinnedIds?.has(workspace.id) ?? false,
    canLeave: Boolean(viewerId && viewerId !== workspace.ownerId && !workspace.isOrgAdmin),
  }
}

/** Assistant chats live under Search. */
function toShellChat(scope: SurfaceScope, chat: MothershipChatMetadata): ShellChat {
  return {
    id: chat.id,
    title: chat.name,
    mode: chat.mode,
    href: surfaceHref(
      scope,
      chat.mode === 'assistant' ? `/search/chat/${chat.id}` : `/chat/${chat.id}`
    ),
    isActive: chat.isActive,
    isUnread: chat.isUnread,
    isPinned: chat.isPinned,
    updatedAt: chat.updatedAt.toISOString(),
  }
}

function toShellUser(profile: UserProfile | undefined): ShellData['user'] {
  return {
    name: profile?.name?.trim() || profile?.email || '',
    id: profile?.id,
    email: profile?.email,
    image: profile?.image ?? null,
  }
}

function toWorkspaceCreation(
  policy: WorkspaceCreationPolicy | null | undefined
): ShellData['workspaceCreation'] {
  if (!policy) return undefined
  return {
    canCreate: policy.canCreate,
    organizationId: policy.organizationId,
    reason: policy.reason,
  }
}

export interface ShellNavigation {
  destinations: readonly ShellDestination[]
  settingsNavigation: NonNullable<ShellData['settingsNavigation']>
}

/**
 * The viewer's real shell: data shaped as the prop fixtures fill, and actions backed by mutations.
 * The inbox and tray history stay empty because neither has a backend, and `unbacked` hides what an
 * empty value alone would misrepresent.
 */
export function useShellData(navigation: ShellNavigation): LiveShell {
  const organization = useOrganization()
  const { id: organizationId } = organization.organization
  const workspaces = useOrderedWorkspacesQuery()
  const pinnedIds = usePinnedWorkspaceIds()
  const creationPolicy = useWorkspaceCreationPolicy()
  const chatsAvailable = organization.mothershipAvailable
  const chats = useOrganizationMothershipChats(organizationId, 'active', {
    enabled: chatsAvailable,
  })
  const canOpenChat = useCanOpenOrganizationChat()
  const profile = useUserProfile()
  const settings = useGeneralSettings()
  const chatActions = useChatListActions(organizationId)
  const workspaceActions = useWorkspaceActions(organizationId, liveWorkspaceHome, profile.data?.id)
  const accountActions = useLiveAccountActions(organization, navigation.destinations)
  const navWarmers = useNavWarmers()

  const theme = settings.data?.theme
  const workspaceRows = workspaces.data
  const pinned = pinnedIds.data
  const viewer = profile.data
  const chatRows = chats.data
  const workspacesStatus = workspaces.isRefetchError ? 'success' : workspaces.status
  const chatsStatus = !chatsAvailable || chats.isRefetchError ? 'success' : chats.status
  const profileStatus = profile.status
  const policy = creationPolicy.data
  const data = useMemo<ShellData>(
    () => ({
      appearance: theme,
      organization: organization.organization,
      user: toShellUser(viewer),
      // A viewer belongs to one organization, the only one whose shell they can open, and every
      // workspace they can open renders in it (`readWorkspaceShell`): its own, an
      // organization-less one, and another team's they collaborate on.
      workspaces: (workspaceRows ?? []).map((workspace) =>
        toShellWorkspace(workspace, pinned, viewer?.id)
      ),
      chats: (chatRows ?? []).filter(canOpenChat).map((chat) => toShellChat(organization, chat)),
      inbox: [],
      notifications: [],
      unbacked: ['inbox'],
      status: { workspaces: workspacesStatus, chats: chatsStatus, profile: profileStatus },
      workspaceCreation: toWorkspaceCreation(policy),
      workspacePageSize: SIDEBAR_PAGE_SIZE,
      chatPageSize: SIDEBAR_PAGE_SIZE,
      chatsAvailable,
      surface: organization,
      destinations: navigation.destinations,
      settingsNavigation: navigation.settingsNavigation,
    }),
    [
      theme,
      organization,
      viewer,
      workspaceRows,
      pinned,
      chatRows,
      canOpenChat,
      workspacesStatus,
      chatsStatus,
      profileStatus,
      policy,
      chatsAvailable,
      navigation,
    ]
  )

  const { refetch: refetchChats } = chats
  const { refetch: refetchWorkspaces } = workspaces
  const actions = useMemo<ShellActions>(
    () => ({
      ...accountActions,
      warmDestination(destinationId) {
        navWarmers.schedule(destinationId)
        return navWarmers.cancel
      },
      warmSettings: navWarmers.warmSettings,
      chats: { ...chatActions, retry: () => void refetchChats() },
      workspaces: { ...workspaceActions, retry: () => void refetchWorkspaces() },
    }),
    [accountActions, navWarmers, chatActions, workspaceActions, refetchChats, refetchWorkspaces]
  )

  return useMemo(() => ({ data, actions }), [data, actions])
}
