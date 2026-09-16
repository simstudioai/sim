'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Chip,
  ChipConfirmModal,
  ChipInput,
  ChipModalError,
  ChipModalField,
  ChipSelect,
  Label,
  OverflowText,
  Search,
  Switch,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import type { MothershipEnvironment } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/auth-client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { AddUserModal } from '@/app/workspace/[workspaceId]/settings/components/admin/add-user-modal'
import {
  adminParsers,
  adminUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/admin/search-params'
import { useRecentImpersonations } from '@/app/workspace/[workspaceId]/settings/components/admin/use-recent-impersonations'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  type AdminUser,
  useAdminUsers,
  useAdminUsersByEmails,
  useBanUser,
  useImpersonateUser,
  useSendPasswordReset,
  useSetUserRole,
  useUnbanUser,
} from '@/hooks/queries/admin-users'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useImportWorkflow } from '@/hooks/queries/workflows'
import { clearUserData } from '@/stores'

const PAGE_SIZE = 20 as const

const USER_TABLE_HEADER = (
  <div className='flex items-center gap-3 px-3 pb-1 text-[var(--text-tertiary)] text-caption'>
    <span className='w-[170px]'>Name</span>
    <span className='flex-1'>Email</span>
    <span className='w-[60px]'>Role</span>
    <span className='w-[55px]'>Status</span>
    <span className='w-[150px] text-right'>Actions</span>
  </div>
)

/**
 * The row action awaiting confirmation. Holds ids, never the user row, so a
 * refetch while the modal is open refreshes the name it shows without
 * redirecting the action the admin committed to.
 */
type PendingUserAction =
  | { type: 'ban'; userId: string }
  | { type: 'role'; userId: string; nextRole: 'admin' | 'user' }

const MOTHERSHIP_ENV_OPTIONS: { value: MothershipEnvironment; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
]

export function Admin() {
  const { data: session } = useSession()

  const { data: settings } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()
  const importWorkflow = useImportWorkflow()

  const setUserRole = useSetUserRole()
  const banUser = useBanUser()
  const unbanUser = useUnbanUser()
  const impersonateUser = useImpersonateUser()
  const sendPasswordReset = useSendPasswordReset()
  const { recentEmails, recordImpersonation } = useRecentImpersonations()
  const { data: recentUsers } = useAdminUsersByEmails(recentEmails)

  const [workflowId, setWorkflowId] = useState('')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')

  const [{ q: searchQuery, offset: usersOffset }, setAdminParams] = useQueryStates(
    adminParsers,
    adminUrlKeys
  )

  const [searchInput, setSearchInput] = useState(searchQuery)
  const [pendingAction, setPendingAction] = useState<PendingUserAction | null>(null)
  const [banReason, setBanReason] = useState('')
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null)
  const [impersonationGuardError, setImpersonationGuardError] = useState<string | null>(null)
  const [isAddUserOpen, setIsAddUserOpen] = useState(false)
  const [provisionWarning, setProvisionWarning] = useState<string | null>(null)

  const {
    data: usersData,
    isLoading: usersLoading,
    error: usersError,
  } = useAdminUsers(usersOffset, PAGE_SIZE, searchQuery)

  const handleSearch = () => {
    const trimmed = searchInput.trim()
    setAdminParams({ q: trimmed.length > 0 ? trimmed : null, offset: null })
  }

  const lastSyncedSearchRef = useRef(searchQuery)
  useEffect(() => {
    if (searchQuery === lastSyncedSearchRef.current) return
    lastSyncedSearchRef.current = searchQuery
    setSearchInput((current) => (current === searchQuery ? current : searchQuery))
  }, [searchQuery])

  const totalPages = Math.ceil((usersData?.total ?? 0) / PAGE_SIZE)
  const currentPage = Math.floor(usersOffset / PAGE_SIZE) + 1

  const handleSuperUserModeToggle = async (checked: boolean) => {
    if (checked !== settings?.superUserModeEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'superUserModeEnabled', value: checked })
    }
  }

  const handleMothershipEnvironmentChange = async (nextEnvironment: MothershipEnvironment) => {
    if (nextEnvironment !== settings?.mothershipEnvironment && !updateSetting.isPending) {
      await updateSetting.mutateAsync({
        key: 'mothershipEnvironment',
        value: nextEnvironment,
      })
    }
  }

  const handleImpersonate = (userId: string, email: string) => {
    setImpersonationGuardError(null)
    if (session?.user?.role !== 'admin') {
      setImpersonatingUserId(null)
      setImpersonationGuardError('Only admins can impersonate users.')
      return
    }

    setImpersonatingUserId(userId)
    impersonateUser.reset()
    impersonateUser.mutate(
      { userId },
      {
        onError: () => {
          setImpersonatingUserId(null)
        },
        onSuccess: async () => {
          recordImpersonation(email)
          await clearUserData({ preserveRecentImpersonations: true })
          window.location.assign(APP_ENTRY_PATH)
        },
      }
    )
  }

  const handleImport = () => {
    const sourceId = workflowId.trim()
    const targetId = targetWorkspaceId.trim()
    if (!sourceId || !targetId) return
    importWorkflow.mutate(
      { workflowId: sourceId, targetWorkspaceId: targetId },
      {
        onSuccess: () => {
          setWorkflowId('')
          setTargetWorkspaceId('')
        },
      }
    )
  }

  const pendingUser = pendingAction
    ? (usersData?.users.find((u) => u.id === pendingAction.userId) ??
      recentUsers?.find((u) => u.id === pendingAction.userId) ??
      null)
    : null
  const isDemotion = pendingAction?.type === 'role' && pendingAction.nextRole === 'user'

  const closePendingAction = () => {
    setPendingAction(null)
    setBanReason('')
  }

  const handleConfirmBan = () => {
    if (pendingAction?.type !== 'ban') return
    const trimmedReason = banReason.trim()
    banUser.mutate(
      {
        userId: pendingAction.userId,
        ...(trimmedReason ? { banReason: trimmedReason } : {}),
      },
      { onSuccess: closePendingAction }
    )
  }

  const handleConfirmRoleChange = () => {
    if (pendingAction?.type !== 'role') return
    setUserRole.mutate(
      { userId: pendingAction.userId, role: pendingAction.nextRole },
      { onSuccess: closePendingAction }
    )
  }

  const pendingUserIds = new Set<string>()
  for (const mutation of [setUserRole, banUser, unbanUser, impersonateUser, sendPasswordReset]) {
    if (mutation.isPending && mutation.variables?.userId)
      pendingUserIds.add(mutation.variables.userId)
  }
  if (impersonatingUserId) pendingUserIds.add(impersonatingUserId)

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
              disabled={pendingUserIds.has(u.id)}
            >
              {impersonatingUserId === u.id ? 'Switching...' : 'Impersonate'}
            </Chip>
            <RowActionsMenu
              label={`${u.email} actions`}
              actions={[
                {
                  label: 'Reset password',
                  onSelect: () => {
                    setProvisionWarning(null)
                    sendPasswordReset.mutate(
                      { userId: u.id, email: u.email },
                      {
                        onSuccess: () => toast.success(`Password reset email sent to ${u.email}`),
                        onError: (error) =>
                          toast.error(
                            getErrorMessage(
                              error,
                              `Could not send a password reset email to ${u.email}`
                            )
                          ),
                      }
                    )
                  },
                  disabled: pendingUserIds.has(u.id),
                },
                {
                  label: u.role === 'admin' ? 'Demote' : 'Promote',
                  onSelect: () => {
                    setUserRole.reset()
                    setPendingAction({
                      type: 'role',
                      userId: u.id,
                      nextRole: u.role === 'admin' ? 'user' : 'admin',
                    })
                  },
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
                      onSelect: () => {
                        banUser.reset()
                        setBanReason('')
                        setPendingAction({ type: 'ban', userId: u.id })
                      },
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
            disabled={importWorkflow.isPending}
          />
          <ChipInput
            value={targetWorkspaceId}
            onChange={(event) => {
              setTargetWorkspaceId(event.target.value)
              importWorkflow.reset()
            }}
            placeholder='Target workspace ID'
            disabled={importWorkflow.isPending}
          />
          <Button
            variant='primary'
            onClick={handleImport}
            disabled={importWorkflow.isPending || !workflowId.trim() || !targetWorkspaceId.trim()}
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
            <p className='text-[var(--text-error)] text-small'>
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
                      className='h-[28px] px-2 text-caption'
                      onClick={() =>
                        setAdminParams((prev) => ({
                          offset: Math.max(0, prev.offset - PAGE_SIZE),
                        }))
                      }
                      disabled={usersOffset === 0 || usersLoading}
                    >
                      Previous
                    </Button>
                    <Button
                      variant='active'
                      className='h-[28px] px-2 text-caption'
                      onClick={() =>
                        setAdminParams((prev) => ({ offset: prev.offset + PAGE_SIZE }))
                      }
                      disabled={usersOffset + PAGE_SIZE >= (usersData?.total ?? 0) || usersLoading}
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
        onCreated={(user, resetEmailError) => {
          // Search for the new user either way: when the reset email failed,
          // the recovery action named below lives on that user's row.
          setSearchInput(user.email)
          setAdminParams({ q: user.email, offset: null })
          setProvisionWarning(
            resetEmailError
              ? `Created ${user.email}, but the password reset email failed to send (${resetEmailError}). Use Reset password in that row's actions menu to try again.`
              : null
          )
        }}
      />
    </SettingsPanel>
  )
}
