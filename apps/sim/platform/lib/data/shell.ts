import type { Workspace, WorkspaceCreationPolicy } from '@/lib/api/contracts'
import type { UserProfile } from '@/hooks/queries/current-user-data'
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
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'

/** The legacy sidebar's rule for its Chats section; the list read answers 403 outside it. */
export function canListOrganizationChats({ access }: PlatformOrganization): boolean {
  return access.mothershipAvailable && (access.canBuild || access.searchAccess.memberScoped)
}

function toShellWorkspace(
  workspace: Workspace,
  pinnedIds: ReadonlySet<string> | undefined
): ShellWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    logoUrl: workspace.logoUrl ?? null,
    permissions: workspace.permissions,
    isPinned: pinnedIds?.has(workspace.id) ?? false,
  }
}

/** Assistant chats live under Search, which stays on the legacy surface. */
function toShellChat(chat: MothershipChatMetadata, organization: PlatformOrganization): ShellChat {
  return {
    id: chat.id,
    title: chat.name,
    mode: chat.mode,
    href:
      chat.mode === 'assistant'
        ? legacyRoutes(organization).searchChat(chat.id)
        : `/chat/${chat.id}`,
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
 * The viewer's real shell, shaped as the prop fixtures fill. The inbox and tray history stay empty
 * because neither has a backend, and `unbacked` hides what an empty value alone would misrepresent.
 */
export function useShellData(navigation: ShellNavigation): ShellData {
  const organization = useOrganization()
  const { id: organizationId } = organization.organization
  const workspaces = useOrderedWorkspacesQuery()
  const pinnedIds = usePinnedWorkspaceIds()
  const creationPolicy = useWorkspaceCreationPolicy()
  const chats = useOrganizationMothershipChats(organizationId, 'active', {
    enabled: canListOrganizationChats(organization),
  })
  const profile = useUserProfile()
  return {
    organization: organization.organization,
    user: toShellUser(profile.data),
    workspaces: (workspaces.data ?? [])
      .filter((workspace) => workspace.organizationId === organizationId)
      .map((workspace) => toShellWorkspace(workspace, pinnedIds.data)),
    chats: (chats.data ?? []).map((chat) => toShellChat(chat, organization)),
    inbox: [],
    notifications: [],
    unbacked: ['inbox', 'sortWorkspaces'],
    status: { workspaces: workspaces.status, chats: chats.status, profile: profile.status },
    workspaceCreation: toWorkspaceCreation(creationPolicy.data),
    surface: organization,
    destinations: navigation.destinations,
    settingsNavigation: navigation.settingsNavigation,
  }
}
