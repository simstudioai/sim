'use client'

import { ANONYMOUS_USER_ID } from '@sim/auth/principal'
import type { Workspace } from '@/lib/api/contracts'
import { organizationRoutes } from '@/lib/navigation/paths'
import { canUseOrganizationChat } from '@/lib/organizations/home-redirect'
import { useOrganization } from '@/lib/organizations/provider'
import type { UserProfile } from '@/hooks/queries/current-user-data'
import type { MothershipChatMetadata } from '@/hooks/queries/mothership-chats'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useUserProfile } from '@/hooks/queries/user-profile'
import {
  useOrderedWorkspacesQuery,
  usePinnedWorkspaceIds,
  useWorkspaceCreationPolicy,
} from '@/hooks/queries/workspace'
import {
  organizationChatHref,
  useCanOpenOrganizationChat,
} from '@/platform/embedded/lib/data/chat-list'
import { buildOrganizationNavItems } from '@/platform/embedded/lib/data/shell-destinations'
import type { ShellChat, ShellData, ShellWorkspace } from '@/platform/embedded/lib/data/shell-view'
import { workspaceHref } from '@/platform/embedded/lib/data/workspaces'

function toShellWorkspace(
  workspace: Workspace,
  pinnedIds: ReadonlySet<string> | undefined
): ShellWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    href: workspaceHref(workspace.id),
    logoUrl: workspace.logoUrl,
    permissions: workspace.permissions ?? null,
    isPinned: pinnedIds?.has(workspace.id) ?? false,
  }
}

function toShellChat(
  chat: MothershipChatMetadata,
  routes: ReturnType<typeof organizationRoutes>
): ShellChat {
  return {
    id: chat.id,
    title: chat.name,
    href: organizationChatHref(chat, routes),
    isActive: chat.isActive,
    isUnread: chat.isUnread,
    isPinned: chat.isPinned,
  }
}

function toShellUser(profile: UserProfile | undefined): ShellData['user'] {
  if (!profile) return undefined
  return {
    name: profile.name?.trim() || profile.email,
    image: profile.image ?? null,
    canSignOut: profile.id !== ANONYMOUS_USER_ID,
  }
}

export interface OrganizationNavFlags {
  benchmarkEnabled: boolean
  simLinksEnabled: boolean
  peopleEnabled: boolean
}

/**
 * The viewer's shell, shaped for the sidebar's views and read through the hooks and keys the layout
 * prefetches, so the rail paints hydrated. A failed background refetch keeps the rows it has, and
 * says nothing: only a list that never loaded reports a failure.
 */
export function useOrganizationShell(flags: OrganizationNavFlags) {
  const context = useOrganization()
  const { organization, searchAccess } = context
  const routes = organizationRoutes(organization.id)
  const workspaces = useOrderedWorkspacesQuery()
  const pinnedIds = usePinnedWorkspaceIds()
  const { data: policy } = useWorkspaceCreationPolicy()
  const chatsAvailable = canUseOrganizationChat(context)
  const chats = useOrganizationMothershipChats(organization.id, 'active', {
    enabled: chatsAvailable,
  })
  const canOpenChat = useCanOpenOrganizationChat()
  const profile = useUserProfile()
  const data: ShellData = {
    organization,
    user: toShellUser(profile.data),
    workspaces: (workspaces.data ?? [])
      .filter((workspace) => workspace.organizationId === organization.id)
      .map((workspace) => toShellWorkspace(workspace, pinnedIds.data)),
    chats: chatsAvailable
      ? (chats.data ?? []).filter(canOpenChat).map((chat) => toShellChat(chat, routes))
      : [],
    status: {
      workspaces: workspaces.isRefetchError ? 'success' : workspaces.status,
      chats: chats.isRefetchError ? 'success' : chats.status,
    },
    workspaceCreation: {
      canCreate: policy?.canCreate === true && policy.organizationId === organization.id,
      reason: policy?.reason ?? null,
    },
    chatsAvailable,
    destinations: buildOrganizationNavItems(organization.id, {
      searchAvailable: searchAccess.memberScoped,
      homeAvailable: chatsAvailable,
      ...flags,
    }),
  }
  return {
    data,
    retryChats: () => void chats.refetch(),
    retryWorkspaces: () => void workspaces.refetch(),
  }
}
