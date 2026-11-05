'use client'

import { ANONYMOUS_USER_ID } from '@sim/auth/principal'
import type { Workspace, WorkspaceCreationPolicy } from '@/lib/api/contracts'
import { organizationRoutes, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import type { UserProfile } from '@/hooks/queries/current-user-data'
import type { MothershipChatMetadata } from '@/hooks/queries/mothership-chats'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'
import { useUserProfile } from '@/hooks/queries/user-profile'
import {
  useOrderedWorkspacesQuery,
  usePinnedWorkspaceIds,
  useWorkspaceCreationPolicy,
} from '@/hooks/queries/workspace'
import { buildOrganizationNavItems } from '@/platform/app/(shell)/_components/destinations'
import type {
  ShellActions,
  ShellChat,
  ShellData,
  ShellWorkspace,
} from '@/platform/app/(shell)/_components/model'
import { useChatListActions } from '@/platform/lib/data/chat-list'
import { useAccountActions } from '@/platform/lib/data/shell-actions'
import { useWorkspaceActions } from '@/platform/lib/data/workspaces'

const workspaceHref = (workspaceId: string) => `${WORKSPACES_PATH}/${workspaceId}`

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
    href: chat.mode === 'assistant' ? routes.searchChat(chat.id) : routes.chat(chat.id),
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

export interface OrganizationNavFlags {
  benchmarkEnabled: boolean
  simLinksEnabled: boolean
  peopleEnabled: boolean
}

/**
 * The viewer's shell, shaped for the sidebar's views and backed by the hooks and keys the layout
 * prefetches, so the rail paints hydrated.
 */
export function useOrganizationShell(flags: OrganizationNavFlags): {
  data: ShellData
  actions: ShellActions
} {
  const { organization, viewer, searchAccess, mothershipAvailable, canBuild, deployment } =
    useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  const workspaces = useOrderedWorkspacesQuery()
  const pinnedIds = usePinnedWorkspaceIds()
  const creationPolicy = useWorkspaceCreationPolicy()
  const chatsAvailable = mothershipAvailable && (canBuild || searchAccess.memberScoped)
  const chats = useOrganizationMothershipChats(organization.id, 'active', {
    enabled: chatsAvailable,
  })
  const profile = useUserProfile()
  const chatActions = useChatListActions(organization.id)
  const workspaceActions = useWorkspaceActions(workspaceHref)
  const accountActions = useAccountActions({
    organizationId: organization.id,
    hosted: deployment.hosted,
    viewer,
  })
  return {
    data: {
      organization,
      user: toShellUser(profile.data),
      workspaces: (workspaces.data ?? [])
        .filter((workspace) => workspace.organizationId === organization.id)
        .map((workspace) => toShellWorkspace(workspace, pinnedIds.data)),
      chats: (chats.data ?? []).map((chat) => toShellChat(chat, routes)),
      status: {
        workspaces: workspaces.status,
        chats: chats.status,
      },
      workspaceCreation: toWorkspaceCreation(creationPolicy.data),
      chatsAvailable,
      destinations: buildOrganizationNavItems(organization.id, {
        searchAvailable: searchAccess.memberScoped,
        homeAvailable: (mothershipAvailable && canBuild) || searchAccess.memberScoped,
        ...flags,
      }),
    },
    actions: {
      ...accountActions,
      chats: { ...chatActions, retry: () => void chats.refetch() },
      workspaces: { ...workspaceActions, retry: () => void workspaces.refetch() },
    },
  }
}
