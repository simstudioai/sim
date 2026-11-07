'use client'

import {
  Badge,
  Button,
  Chip,
  ChipConfirmModal,
  ChipInput,
  ChipLink,
  ChipModalError,
  ChipModalField,
  ChipSelect,
  Label,
  OverflowText,
  Search,
  Switch,
} from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import type { MothershipEnvironment } from '@/lib/api/contracts'
import { AddUserModal } from '@/app/workspace/[workspaceId]/settings/components/admin/add-user-modal'
import {
  ADMIN_PAGE_SIZE,
  MOTHERSHIP_ENV_OPTIONS,
  useAdminConsole,
} from '@/app/workspace/[workspaceId]/settings/components/admin/use-admin-console'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import type { AdminUser } from '@/hooks/queries/admin-users'

const USER_TABLE_HEADER = (
  <div className='flex items-center gap-3 px-3 pb-1 text-[var(--text-tertiary)] text-caption'>
    <span className='w-[170px]'>Name</span>
    <span className='flex-1'>Email</span>
    <span className='w-[60px]'>Role</span>
    <span className='w-[55px]'>Status</span>
    <span className='w-[150px] text-right'>Actions</span>
  </div>
)

export function Admin() {
  const {
    banReason,
    banUser,
    benchmarkAvailability,
    closePendingAction,
    currentPage,
    handleConfirmBan,
    handleConfirmRoleChange,
    handleImpersonate,
    handleImport,
    handleMothershipEnvironmentChange,
    handleSearch,
    handleSuperUserModeToggle,
    handleUserCreated,
    impersonateUser,
    impersonatingUserId,
    impersonationGuardError,
    importWorkflow,
    isAddUserOpen,
    isDemotion,
    isImpersonating,
    pendingAction,
    pendingUser,
    pendingUserIds,
    provisionWarning,
    recentUsers,
    searchInput,
    searchQuery,
    sendPasswordReset,
    sendReset,
    session,
    setAdminParams,
    setBanReason,
    setIsAddUserOpen,
    setSearchInput,
    setTargetWorkspaceId,
    setUserRole,
    setWorkflowId,
    settings,
    startBan,
    startRoleChange,
    targetWorkspaceId,
    totalPages,
    unbanUser,
    updateSetting,
    usersData,
    usersError,
    usersLoading,
    usersOffset,
    workflowId,
  } = useAdminConsole()

  const renderUserRow = (u: AdminUser) => (
    <div key={u.id} className='flex items-center gap-3 px-3 py-2 text-small'>
      <OverflowText label={u.name || '—'} className='w-[170px] text-[var(--text-primary)]' />
      <OverflowText label={u.email} className='flex-1 text-[var(--text-secondary)]' />
      <span className='w-[60px]'>
        <Badge variant={u.role === 'admin' ? 'blue' : 'gray'}>{u.role || 'user'}</Badge>
      </span>
      <span className='w-[55px]'>
        {u.banned ? <Badge variant='red'>Banned</Badge> : <Badge variant='green'>Active</Badge>}
      </span>
      <span className='flex w-[150px] items-center justify-end gap-1'>
        {u.id !== session?.user?.id && (
          <>
            <Chip
              aria-label={`Impersonate ${u.email}`}
              onClick={() => handleImpersonate(u.id, u.email)}
              disabled={importWorkflow.isPending || isImpersonating || pendingUserIds.has(u.id)}
            >
              {impersonatingUserId === u.id ? 'Switching...' : 'Impersonate'}
            </Chip>
            <RowActionsMenu
              label={`${u.email} actions`}
              actions={[
                {
                  label: 'Reset password',
                  onSelect: () => sendReset(u),
                  disabled: pendingUserIds.has(u.id),
                },
                {
                  label: u.role === 'admin' ? 'Demote' : 'Promote',
                  onSelect: () => startRoleChange(u),
                  disabled: pendingUserIds.has(u.id),
                },
                u.banned
                  ? {
                      label: 'Unban',
                      onSelect: () => unbanUser.mutate({ userId: u.id }),
                      disabled: pendingUserIds.has(u.id),
                    }
                  : {
                      label: 'Ban',
                      onSelect: () => startBan(u),
                      destructive: true,
                      disabled: pendingUserIds.has(u.id),
                    },
              ]}
            />
          </>
        )}
      </span>
    </div>
  )

  return (
    <SettingsPanel>
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='super-user-mode'>Super admin mode</Label>
          <Switch
            id='super-user-mode'
            checked={settings?.superUserModeEnabled ?? false}
            disabled={updateSetting.isPending}
            onCheckedChange={handleSuperUserModeToggle}
          />
        </div>

        {settings?.superUserModeEnabled && benchmarkAvailability.data?.available && (
          <div>
            <ChipLink href='/benchmark'>Open benchmarks</ChipLink>
          </div>
        )}

        {settings?.superUserModeEnabled && (
          <>
            <div className='flex items-center justify-between gap-3'>
              <div className='flex flex-col gap-1'>
                <Label>Mothership Environment</Label>
                <p className='text-[var(--text-secondary)] text-caption'>
                  Default uses the configured Sim agent URL.
                </p>
              </div>
              <ChipSelect
                align='start'
                dropdownWidth={160}
                value={settings?.mothershipEnvironment ?? 'default'}
                onChange={(value) =>
                  handleMothershipEnvironmentChange(value as MothershipEnvironment)
                }
                placeholder='Select environment'
                disabled={updateSetting.isPending}
                options={MOTHERSHIP_ENV_OPTIONS}
              />
            </div>
          </>
        )}
      </div>

      <div className='h-px bg-[var(--border)]' />

      <div className='flex flex-col gap-2'>
        <p className='text-[var(--text-secondary)] text-sm'>
          Import a workflow and its copilot chats into a target workspace.
        </p>
        <div className='flex gap-2'>
          <ChipInput
            value={workflowId}
            onChange={(event) => {
              setWorkflowId(event.target.value)
              importWorkflow.reset()
            }}
            placeholder='Source workflow ID'
            disabled={importWorkflow.isPending || isImpersonating}
          />
          <ChipInput
            value={targetWorkspaceId}
            onChange={(event) => {
              setTargetWorkspaceId(event.target.value)
              importWorkflow.reset()
            }}
            placeholder='Target workspace ID'
            disabled={importWorkflow.isPending || isImpersonating}
          />
          <Button
            variant='primary'
            onClick={handleImport}
            disabled={
              importWorkflow.isPending ||
              isImpersonating ||
              !workflowId.trim() ||
              !targetWorkspaceId.trim()
            }
          >
            {importWorkflow.isPending ? 'Importing...' : 'Import'}
          </Button>
        </div>
        {importWorkflow.error && (
          <p className='text-[var(--text-error)] text-small'>{importWorkflow.error.message}</p>
        )}
        {importWorkflow.isSuccess && (
          <p className='text-[var(--text-secondary)] text-small'>
            Workflow imported successfully (new ID: {importWorkflow.data.newWorkflowId},{' '}
            {importWorkflow.data.copilotChatsImported ?? 0} copilot chats imported)
          </p>
        )}
      </div>

      <div className='h-px bg-[var(--border)]' />

      <SettingsSection
        label='User management'
        action={<Chip onClick={() => setIsAddUserOpen(true)}>Add user</Chip>}
      >
        <div className='flex flex-col gap-3'>
          <div className='flex gap-2'>
            <ChipInput
              icon={Search}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder='Search by email or paste a user ID...'
              className='min-w-0 flex-1'
            />
            <Button variant='primary' onClick={handleSearch} disabled={usersLoading}>
              {usersLoading ? 'Searching...' : 'Search'}
            </Button>
          </div>

          {usersError && (
            <p className='text-[var(--text-muted)] text-small'>
              {getErrorMessage(usersError, 'Failed to fetch users')}
            </p>
          )}

          {(unbanUser.error || impersonateUser.error || impersonationGuardError) && (
            <p className='text-[var(--text-error)] text-small'>
              {impersonationGuardError ||
                (unbanUser.error || impersonateUser.error)?.message ||
                'Action failed. Please try again.'}
            </p>
          )}

          {provisionWarning && (
            <p className='text-[var(--text-error)] text-small'>{provisionWarning}</p>
          )}

          {sendPasswordReset.isPending && sendPasswordReset.variables && (
            <p className='text-[var(--text-secondary)] text-small'>
              Sending a password reset email to {sendPasswordReset.variables.email}...
            </p>
          )}

          {searchQuery.length > 0 && usersData ? (
            <>
              <div className='flex flex-col gap-0.5'>
                {USER_TABLE_HEADER}

                {usersData.users.length === 0 && (
                  <SettingsEmptyState variant='inline'>No users found.</SettingsEmptyState>
                )}

                {usersData.users.map((u) => renderUserRow(u))}
              </div>

              {totalPages > 1 && (
                <div className='flex items-center justify-between text-[var(--text-secondary)] text-small'>
                  <span>
                    Page {currentPage} of {totalPages} ({usersData.total} users)
                  </span>
                  <div className='flex gap-1'>
                    <Button
                      variant='active'
                      className='h-[28px] text-caption'
                      onClick={() =>
                        setAdminParams((prev) => ({
                          offset: Math.max(0, prev.offset - ADMIN_PAGE_SIZE),
                        }))
                      }
                      disabled={usersOffset === 0 || usersLoading}
                    >
                      Previous
                    </Button>
                    <Button
                      variant='active'
                      className='h-[28px] text-caption'
                      onClick={() =>
                        setAdminParams((prev) => ({ offset: prev.offset + ADMIN_PAGE_SIZE }))
                      }
                      disabled={
                        usersOffset + ADMIN_PAGE_SIZE >= (usersData?.total ?? 0) || usersLoading
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            searchQuery.length === 0 &&
            recentUsers &&
            recentUsers.length > 0 && (
              <div className='flex flex-col gap-0.5'>
                {USER_TABLE_HEADER}
                {recentUsers.map((u) => renderUserRow(u))}
              </div>
            )
          )}
        </div>
      </SettingsSection>
      <ChipConfirmModal
        open={pendingAction?.type === 'ban'}
        onOpenChange={(open) => {
          if (!open) closePendingAction()
        }}
        srTitle='Ban user'
        title='Ban user'
        defaultAction='none'
        text={[
          'Banning ',
          { text: pendingUser?.email ?? 'this user', bold: true },
          ' ',
          {
            text: 'signs them out everywhere and blocks them from signing back in.',
            error: true,
          },
          ' You can unban them later.',
        ]}
        confirm={{
          label: 'Ban',
          onClick: handleConfirmBan,
          pending: banUser.isPending,
          pendingLabel: 'Banning...',
        }}
      >
        <ChipModalField
          type='input'
          title='Reason'
          value={banReason}
          onChange={setBanReason}
          placeholder='Optional'
          disabled={banUser.isPending}
        />
        <ChipModalError>{banUser.error?.message}</ChipModalError>
      </ChipConfirmModal>

      <ChipConfirmModal
        open={pendingAction?.type === 'role'}
        onOpenChange={(open) => {
          if (!open) closePendingAction()
        }}
        srTitle={isDemotion ? 'Demote user' : 'Promote user'}
        title={isDemotion ? 'Demote user' : 'Promote user'}
        text={[
          isDemotion ? 'Demoting ' : 'Promoting ',
          { text: pendingUser?.email ?? 'this user', bold: true },
          ' ',
          isDemotion
            ? { text: 'revokes their platform admin access.', error: true }
            : 'grants full platform admin access, including impersonating any user.',
        ]}
        confirm={{
          label: isDemotion ? 'Demote' : 'Promote',
          onClick: handleConfirmRoleChange,
          variant: isDemotion ? 'destructive' : 'primary',
          pending: setUserRole.isPending,
          pendingLabel: isDemotion ? 'Demoting...' : 'Promoting...',
        }}
      >
        <ChipModalError>{setUserRole.error?.message}</ChipModalError>
      </ChipConfirmModal>

      <AddUserModal
        open={isAddUserOpen}
        onOpenChange={setIsAddUserOpen}
        onCreated={handleUserCreated}
      />
    </SettingsPanel>
  )
}
