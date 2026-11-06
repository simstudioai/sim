'use client'

import { useEffect } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ADMIN_PAGE_SIZE,
  MOTHERSHIP_ENV_OPTIONS,
  useAdminConsole,
} from '@/app/workspace/[workspaceId]/settings/components/admin/use-admin-console'
import type { AdminUser } from '@/hooks/queries/admin-users'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'
import {
  ActionRow,
  FieldStack,
  Muted,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { AddUserModal } from '@/platform/app/(shell)/settings/_components/sections/admin/add-user-modal'
import {
  ActionMenu,
  Button,
  Chip,
  ConfirmDialog,
  DataTable,
  EmptyState,
  InlineNotice,
  Pagination,
  SearchField,
  SelectField,
  StatusTag,
  Switch,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

const USER_COLUMNS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'email', label: 'Email', kind: 'text' },
  { key: 'role', label: 'Role', kind: 'status' },
  { key: 'status', label: 'Status', kind: 'status' },
] as const

export default function AdminSection() {
  useCaptureWhenReady('settings_tab_viewed', { plane: 'account', section: 'admin' }, 'admin')
  const admin = useAdminConsole()
  const { settings, importWorkflow, usersData, searchQuery, pendingUserIds } = admin
  const superUser = settings?.superUserModeEnabled ?? false

  const userRows = (users: readonly AdminUser[]) =>
    users.map((user) => ({
      id: user.id,
      values: {
        name: user.name || '—',
        email: user.email,
        role: user.role || 'user',
        status: user.banned ? 'Banned' : 'Active',
      },
      cells: {
        role: (
          <StatusTag
            label={user.role || 'user'}
            intent={user.role === 'admin' ? 'info' : 'neutral'}
          />
        ),
        status: user.banned ? (
          <StatusTag label='Banned' intent='danger' />
        ) : (
          <StatusTag label='Active' intent='success' />
        ),
      },
      action:
        user.id === admin.session?.user?.id ? undefined : (
          <ActionMenu
            label={`${user.email} actions`}
            icon='I108'
            actions={[
              {
                id: 'impersonate',
                label: admin.impersonatingUserId === user.id ? 'Switching…' : 'Impersonate',
                disabled:
                  importWorkflow.isPending || admin.isImpersonating || pendingUserIds.has(user.id),
                onSelect: () => admin.handleImpersonate(user.id, user.email),
              },
              {
                id: 'reset',
                label: 'Reset password',
                disabled: pendingUserIds.has(user.id),
                onSelect: () => admin.sendReset(user),
              },
              {
                id: 'role',
                label: user.role === 'admin' ? 'Demote' : 'Promote',
                disabled: pendingUserIds.has(user.id),
                onSelect: () => admin.startRoleChange(user),
              },
              user.banned
                ? {
                    id: 'unban',
                    label: 'Unban',
                    disabled: pendingUserIds.has(user.id),
                    onSelect: () => admin.unbanUser.mutate({ userId: user.id }),
                  }
                : {
                    id: 'ban',
                    label: 'Ban',
                    destructive: true,
                    separatorBefore: true,
                    disabled: pendingUserIds.has(user.id),
                    onSelect: () => admin.startBan(user),
                  },
            ]}
          />
        ),
    }))

  const actionError =
    admin.impersonationGuardError ??
    (admin.unbanUser.error || admin.impersonateUser.error
      ? ((admin.unbanUser.error ?? admin.impersonateUser.error)?.message ??
        'Action failed. Try again.')
      : null)
  const pendingEmail = admin.pendingUser?.email ?? 'this user'
  const importError = importWorkflow.error?.message
  // These mutations live in the shared admin console, so failure is reported from where it surfaces.
  useEffect(() => {
    if (actionError) toast.error(actionError)
  }, [actionError])
  useEffect(() => {
    if (importError) toast.error(importError)
  }, [importError])

  return (
    <SectionStack>
      <SettingsSection title='Platform'>
        <SettingsRow label='Super admin mode'>
          <Switch
            label='Super admin mode'
            checked={superUser}
            disabled={admin.updateSetting.isPending}
            onCheckedChange={(checked) => void admin.handleSuperUserModeToggle(checked)}
          />
        </SettingsRow>
        {superUser && admin.benchmarkAvailability.data?.available && (
          <SettingsRow label='Benchmarks'>
            <Chip href='/benchmark'>Open benchmarks</Chip>
          </SettingsRow>
        )}
        {superUser && (
          <SettingsRow
            label='Mothership environment'
            description='Default uses the configured Sim agent URL.'
            field
          >
            <SelectField
              label='Mothership environment'
              value={settings?.mothershipEnvironment ?? 'default'}
              options={MOTHERSHIP_ENV_OPTIONS}
              disabled={admin.updateSetting.isPending}
              onValueChange={(value) => void admin.handleMothershipEnvironmentChange(value)}
            />
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title='Import workflow'>
        <FieldStack>
          <Muted>Import a workflow and its copilot chats into a target workspace.</Muted>
          <TextField
            label='Source workflow ID'
            placeholder='Source workflow ID'
            value={admin.workflowId}
            disabled={importWorkflow.isPending || admin.isImpersonating}
            onChange={(value) => {
              admin.setWorkflowId(value)
              importWorkflow.reset()
            }}
          />
          <TextField
            label='Target workspace ID'
            placeholder='Target workspace ID'
            value={admin.targetWorkspaceId}
            disabled={importWorkflow.isPending || admin.isImpersonating}
            onChange={(value) => {
              admin.setTargetWorkspaceId(value)
              importWorkflow.reset()
            }}
          />
          <ActionRow>
            <Button
              variant='primary'
              size='compact'
              disabled={
                importWorkflow.isPending ||
                admin.isImpersonating ||
                !admin.workflowId.trim() ||
                !admin.targetWorkspaceId.trim()
              }
              onClick={admin.handleImport}
            >
              {importWorkflow.isPending ? 'Importing…' : 'Import'}
            </Button>
          </ActionRow>
          {importWorkflow.isSuccess && (
            <InlineNotice
              intent='success'
              message={`Workflow imported (new ID: ${importWorkflow.data.newWorkflowId}, ${importWorkflow.data.copilotChatsImported ?? 0} copilot chats imported)`}
            />
          )}
        </FieldStack>
      </SettingsSection>

      <SettingsSection title='User management'>
        <FieldStack>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              admin.handleSearch()
            }}
          >
            <ActionRow>
              <SearchField
                label='Search users'
                placeholder='Search by email or paste a user ID…'
                value={admin.searchInput}
                onValueChange={admin.setSearchInput}
              />
              <Button size='compact' submit disabled={admin.usersLoading}>
                {admin.usersLoading ? 'Searching…' : 'Search'}
              </Button>
              <Button size='compact' icon='I074' onClick={() => admin.setIsAddUserOpen(true)}>
                Add user
              </Button>
            </ActionRow>
          </form>
          {admin.usersError && (
            <InlineNotice
              intent='danger'
              message={getErrorMessage(admin.usersError, 'Failed to fetch users')}
            />
          )}
          {admin.provisionWarning && (
            <InlineNotice intent='warning' message={admin.provisionWarning} />
          )}
          {admin.isImpersonating && <Muted>Switching to that user…</Muted>}
          {admin.sendPasswordReset.isPending && admin.sendPasswordReset.variables && (
            <Muted>
              {`Sending a password reset email to ${admin.sendPasswordReset.variables.email}...`}
            </Muted>
          )}
          {searchQuery.length > 0 && usersData ? (
            <>
              {usersData.users.length === 0 ? (
                <EmptyState title='No users found.' />
              ) : (
                <DataTable
                  title='Users'
                  titleHidden
                  columns={USER_COLUMNS}
                  rows={userRows(usersData.users)}
                />
              )}
              {admin.totalPages > 1 && (
                <>
                  <Muted>
                    {`Page ${admin.currentPage} of ${admin.totalPages} (${usersData.total} users)`}
                  </Muted>
                  <Pagination
                    label='Users pages'
                    page={admin.currentPage}
                    pageCount={admin.totalPages}
                    disabled={admin.usersLoading}
                    onPageChange={(page) =>
                      void admin.setAdminParams({ offset: (page - 1) * ADMIN_PAGE_SIZE })
                    }
                  />
                </>
              )}
            </>
          ) : (
            searchQuery.length === 0 &&
            admin.recentUsers &&
            admin.recentUsers.length > 0 && (
              <DataTable
                title='Recently impersonated'
                columns={USER_COLUMNS}
                rows={userRows(admin.recentUsers)}
              />
            )
          )}
        </FieldStack>
      </SettingsSection>

      {admin.pendingAction?.type === 'ban' && (
        <ConfirmDialog
          target
          onClose={() => admin.closePendingAction()}
          title='Ban user'
          confirmLabel='Ban'
          pendingLabel='Banning…'
          pending={admin.banUser.isPending}
          onConfirm={async () => {
            await admin.handleConfirmBan()
            return false
          }}
        >
          <Muted>
            {`Banning ${pendingEmail} signs them out everywhere and blocks them from signing back in. You can unban them later.`}
          </Muted>
          <TextField
            label='Reason'
            placeholder='Optional'
            value={admin.banReason}
            disabled={admin.banUser.isPending}
            onChange={admin.setBanReason}
          />
          {admin.banUser.error && (
            <InlineNotice intent='danger' message={admin.banUser.error.message} />
          )}
        </ConfirmDialog>
      )}
      {admin.pendingAction?.type === 'role' && (
        <ConfirmDialog
          target
          safe={!admin.isDemotion}
          onClose={() => admin.closePendingAction()}
          title={admin.isDemotion ? 'Demote user' : 'Promote user'}
          confirmLabel={admin.isDemotion ? 'Demote' : 'Promote'}
          pendingLabel={admin.isDemotion ? 'Demoting…' : 'Promoting…'}
          pending={admin.setUserRole.isPending}
          onConfirm={async () => {
            await admin.handleConfirmRoleChange()
            return false
          }}
        >
          <Muted>
            {admin.isDemotion
              ? `Demoting ${pendingEmail} revokes their platform admin access.`
              : `Promoting ${pendingEmail} grants full platform admin access, including impersonating any user.`}
          </Muted>
          {admin.setUserRole.error && (
            <InlineNotice intent='danger' message={admin.setUserRole.error.message} />
          )}
        </ConfirmDialog>
      )}
      {admin.isAddUserOpen && (
        <AddUserModal
          onClose={() => admin.setIsAddUserOpen(false)}
          onCreated={admin.handleUserCreated}
        />
      )}
    </SectionStack>
  )
}
