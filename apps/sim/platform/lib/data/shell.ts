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
import type {
  ShellChat,
  ShellData,
  ShellDestination,
  ShellWorkspace,
} from '@/platform/app/(shell)/_components/model'
import { useChatListActions } from '@/platform/lib/data/chat-list'
import { useOrganization } from '@/platform/lib/data/organization'
import { canListOrganizationChats, legacyRoutes } from '@/platform/lib/data/organization-model'
import { useLiveAccountActions } from '@/platform/lib/data/shell-actions'
import type { LiveShell } from '@/platform/lib/data/shell-context'
import { useWorkspaceActions } from '@/platform/lib/data/workspaces'

type LegacyRoutes = ReturnType<typeof legacyRoutes>

/** The legacy sidebar's page size for its Workspaces section. */
const WORKSPACE_PAGE_SIZE = 5

function toShellWorkspace(
  workspace: Workspace,
  pinnedIds: ReadonlySet<string> | undefined,
  routes: LegacyRoutes
): ShellWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    href: routes.workspace(workspace.id),
    logoUrl: workspace.logoUrl ?? null,
    permissions: workspace.permissions,
    isPinned: pinnedIds?.has(workspace.id) ?? false,
  }
}

/** Assistant chats live under Search, which stays on the legacy surface. */
function toShellChat(chat: MothershipChatMetadata, routes: LegacyRoutes): ShellChat {
  return {
    id: chat.id,
    title: chat.name,
    mode: chat.mode,
    href: chat.mode === 'assistant' ? routes.searchChat(chat.id) : `/chat/${chat.id}`,
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
  const chatsAvailable = canListOrganizationChats(organization)
  const chats = useOrganizationMothershipChats(organizationId, 'active', {
    enabled: chatsAvailable,
  })
  const profile = useUserProfile()
  const settings = useGeneralSettings()
  const routes = legacyRoutes(organization)
  const chatActions = useChatListActions(organizationId)
  const workspaceActions = useWorkspaceActions(routes.workspace)
  const accountActions = useLiveAccountActions(organization, navigation.destinations)
  return {
    data: {
      appearance: settings.data?.theme,
      organization: organization.organization,
      user: toShellUser(profile.data),
      workspaces: (workspaces.data ?? [])
        .filter((workspace) => workspace.organizationId === organizationId)
        .map((workspace) => toShellWorkspace(workspace, pinnedIds.data, routes)),
      chats: (chats.data ?? []).map((chat) => toShellChat(chat, routes)),
      inbox: [],
      notifications: [],
      unbacked: ['inbox', 'sortWorkspaces'],
      status: {
        workspaces: workspaces.status,
        chats: chatsAvailable ? chats.status : 'success',
        profile: profile.status,
      },
      workspaceCreation: toWorkspaceCreation(creationPolicy.data),
      workspacePageSize: WORKSPACE_PAGE_SIZE,
      chatsAvailable,
      surface: organization,
      destinations: navigation.destinations,
      settingsNavigation: navigation.settingsNavigation,
    },
    actions: {
      ...accountActions,
      chats: { ...chatActions, retry: () => void chats.refetch() },
      workspaces: { ...workspaceActions, retry: () => void workspaces.refetch() },
    },
  }
}
