'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState, useQueryStates } from 'nuqs'
import { useSession } from '@/lib/auth/auth-client'
import { InviteModal } from '@/app/workspace/[workspaceId]/components/invite-modal'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import {
  WorkspaceDetail,
  WorkspaceList,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/components'
import { groupRosterByWorkspace } from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/roster-groups'
import {
  organizationWorkspaceDetailParsers,
  organizationWorkspaceDetailUrlKeys,
  organizationWorkspaceIdParam,
  organizationWorkspaceIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useOrganizationRoster } from '@/hooks/queries/organization'

interface OrganizationWorkspacesProps {
  organizationId: string
}

/**
 * Organization-plane Workspaces page. Owns every workspace the organization
 * owns and, for each one, the members who belong to it — the workspace-major
 * reading of the same roster the Members page reads member-major.
 *
 * The list drills into one workspace's access detail, deep-linked by
 * `?workspace-id=`. Both levels carry an invite action, and both open the one
 * invite surface: from the list it offers every workspace the viewer
 * administers, and from a detail it opens with that workspace preselected.
 */
export function OrganizationWorkspaces({ organizationId }: OrganizationWorkspacesProps) {
  const { data: session } = useSession()
  const { data: roster, isLoading, error } = useOrganizationRoster(organizationId)
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [isInviteOpen, setIsInviteOpen] = useState(false)

  /**
   * Absent on the organization plane, which is outside every workspace route.
   * Read only to keep the workspace being viewed from out of the deletable set.
   */
  const hostContext = useOptionalWorkspaceHostContext()

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useQueryState(
    organizationWorkspaceIdParam.key,
    { ...organizationWorkspaceIdParam.parser, ...organizationWorkspaceIdUrlKeys }
  )
  /**
   * Cleared alongside the workspace id so the detail's tab, access filter, and
   * ordering never linger on the list URL. `null` clears the whole group.
   */
  const [, setDetailFilters] = useQueryStates(
    organizationWorkspaceDetailParsers,
    organizationWorkspaceDetailUrlKeys
  )

  const groups = useMemo(() => groupRosterByWorkspace(roster), [roster])
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.workspace.id, group])),
    [groups]
  )

  const openWorkspace = useCallback(
    (workspaceId: string) => {
      // Lingering detail filters must not re-target this open — reset in the same batched push.
      void setDetailFilters(null)
      void setSelectedWorkspaceId(workspaceId)
    },
    [setDetailFilters, setSelectedWorkspaceId]
  )

  const closeWorkspace = useCallback(() => {
    void setDetailFilters(null, { history: 'replace' })
    void setSelectedWorkspaceId(null, { history: 'replace' })
  }, [setDetailFilters, setSelectedWorkspaceId])

  const currentUserId = session?.user?.id ?? ''
  const canManage = isOrgAdminRole(
    roster?.members.find((member) => member.userId === currentUserId)?.role
  )

  /**
   * Derived from the loaded roster rather than duplicated into state. A stale id
   * — a deleted workspace restored from history, or a dead link — resolves to
   * nothing and falls back to the list; the lingering param is harmless and the
   * next selection overwrites it.
   */
  const selectedGroup = selectedWorkspaceId ? groupsById.get(selectedWorkspaceId) : undefined
  /** A deep link arrives before the roster does, so hold the detail frame while it loads. */
  const isDetailFrame = selectedWorkspaceId !== null && (isLoading || selectedGroup !== undefined)

  const back = isDetailFrame
    ? { text: 'Workspaces', icon: ArrowLeft, onSelect: closeWorkspace }
    : undefined

  /**
   * One invite surface for both levels: from the list it offers every workspace
   * the viewer administers, and from a detail it opens with that workspace
   * preselected.
   *
   * Keyed on the workspace because the modal seeds its selection from
   * `workspaceId` in `useState`, which only reads its initial value — without a
   * remount, walking from the list into a workspace would leave the invite
   * preselecting nothing.
   */
  const inviteModal = (
    <InviteModal
      key={selectedGroup?.workspace.id ?? 'organization'}
      open={isInviteOpen}
      onOpenChange={setIsInviteOpen}
      organizationId={organizationId}
      workspaceId={selectedGroup?.workspace.id}
      workspaceName={selectedGroup?.workspace.name}
      canInvite={canManage}
      isOrganizationAdmin={canManage}
    />
  )

  if (isLoading) {
    return (
      <SettingsPanel back={back}>
        <SettingsEmptyState>Loading workspaces...</SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (error) {
    return (
      <SettingsPanel back={back}>
        <SettingsEmptyState tone='error'>
          {getErrorMessage(error, 'Failed to load workspaces')}
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (selectedGroup) {
    return (
      <>
        <WorkspaceDetail
          group={selectedGroup}
          organizationId={organizationId}
          currentUserId={currentUserId}
          canManage={canManage}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          onInvite={() => setIsInviteOpen(true)}
          onBack={closeWorkspace}
        />
        {inviteModal}
      </>
    )
  }

  return (
    <>
      <SettingsPanel
        actions={
          canManage
            ? [
                {
                  text: 'Invite',
                  icon: Plus,
                  variant: 'primary',
                  onSelect: () => setIsInviteOpen(true),
                },
              ]
            : []
        }
      >
        {groups.length === 0 ? (
          <SettingsEmptyState>No workspaces in this organization</SettingsEmptyState>
        ) : (
          <WorkspaceList
            groups={groups}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            canManage={canManage}
            hostWorkspaceId={hostContext?.workspace.id}
            onOpen={openWorkspace}
          />
        )}
      </SettingsPanel>
      {inviteModal}
    </>
  )
}
