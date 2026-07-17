'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, ChipInput, ChipSelect, cn, Label, Search, Switch } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import type { MothershipEnvironment } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/auth-client'
import {
  adminParsers,
  adminUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/admin/search-params'
import { useRecentImpersonations } from '@/app/workspace/[workspaceId]/settings/components/admin/use-recent-impersonations'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  type AdminUser,
  useAdminUsers,
  useAdminUsersByEmails,
  useBanUser,
  useImpersonateUser,
  useSetUserRole,
  useUnbanUser,
} from '@/hooks/queries/admin-users'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useImportWorkflow } from '@/hooks/queries/workflows'
import { clearUserData } from '@/stores'

const PAGE_SIZE = 20 as const

const USER_TABLE_HEADER = (
  <div className='flex items-center gap-3 border-[var(--border)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
    <span className='w-[170px]'>Name</span>
    <span className='flex-1'>Email</span>
    <span className='w-[60px]'>Role</span>
    <span className='w-[55px]'>Status</span>
    <span className='w-[200px] text-right'>Actions</span>
  </div>
)

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
  const { recentEmails, recordImpersonation } = useRecentImpersonations()
  const { data: recentUsers } = useAdminUsersByEmails(recentEmails)

  const [workflowId, setWorkflowId] = useState('')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')

  const [{ q: searchQuery, offset: usersOffset }, setAdminParams] = useQueryStates(
    adminParsers,
    adminUrlKeys
  )

  const [searchInput, setSearchInput] = useState(searchQuery)
  const [banUserId, setBanUserId] = useState<string | null>(null)
  const [banReason, setBanReason] = useState('')
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null)
  const [impersonationGuardError, setImpersonationGuardError] = useState<string | null>(null)

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
          await clearUserData()
          window.location.assign('/workspace')
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

  const pendingUserIds = useMemo(() => {
    const ids = new Set<string>()
    if (setUserRole.isPending && (setUserRole.variables as { userId?: string })?.userId)
      ids.add((setUserRole.variables as { userId: string }).userId)
    if (banUser.isPending && (banUser.variables as { userId?: string })?.userId)
      ids.add((banUser.variables as { userId: string }).userId)
    if (unbanUser.isPending && (unbanUser.variables as { userId?: string })?.userId)
      ids.add((unbanUser.variables as { userId: string }).userId)
    if (impersonateUser.isPending && (impersonateUser.variables as { userId?: string })?.userId)
      ids.add((impersonateUser.variables as { userId: string }).userId)
    if (impersonatingUserId) ids.add(impersonatingUserId)
    return ids
  }, [
    setUserRole.isPending,
    setUserRole.variables,
    banUser.isPending,
    banUser.variables,
    unbanUser.isPending,
    unbanUser.variables,
    impersonateUser.isPending,
    impersonateUser.variables,
    impersonatingUserId,
  ])

  const renderUserRow = (u: AdminUser) => (
    <div
      key={u.id}
      className={cn(
        'flex flex-col gap-2 px-3 py-2 text-small',
        'border-[var(--border)] border-b last:border-b-0'
      )}
    >
      <div className='flex items-center gap-3'>
        <span className='w-[170px] truncate text-[var(--text-primary)]'>{u.name || '—'}</span>
        <span className='flex-1 truncate text-[var(--text-secondary)]'>{u.email}</span>
        <span className='w-[60px]'>
          <Badge variant={u.role === 'admin' ? 'blue' : 'gray'}>{u.role || 'user'}</Badge>
        </span>
        <span className='w-[55px]'>
          {u.banned ? <Badge variant='red'>Banned</Badge> : <Badge variant='green'>Active</Badge>}
        </span>
        <span className='flex w-[200px] justify-end gap-1'>
          {u.id !== session?.user?.id && (
            <>
              <Button
                variant='active'
                className='h-[28px] px-2 text-caption'
                onClick={() => handleImpersonate(u.id, u.email)}
                disabled={pendingUserIds.has(u.id)}
              >
                {impersonatingUserId === u.id ||
                (impersonateUser.isPending &&
                  (impersonateUser.variables as { userId?: string } | undefined)?.userId === u.id)
                  ? 'Switching...'
                  : 'Impersonate'}
              </Button>
              <Button
                variant='active'
                className='h-[28px] px-2 text-caption'
                onClick={() => {
                  setUserRole.reset()
                  setUserRole.mutate({
                    userId: u.id,
                    role: u.role === 'admin' ? 'user' : 'admin',
                  })
                }}
                disabled={pendingUserIds.has(u.id)}
              >
                {u.role === 'admin' ? 'Demote' : 'Promote'}
              </Button>
              {u.banned ? (
                <Button
                  variant='active'
                  className='h-[28px] px-2 text-caption'
                  onClick={() => {
                    unbanUser.reset()
                    unbanUser.mutate({ userId: u.id })
                  }}
                  disabled={pendingUserIds.has(u.id)}
                >
                  Unban
                </Button>
              ) : (
                <Button
                  variant='active'
                  className={cn(
                    'h-[28px] px-2 text-caption',
                    banUserId === u.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-error)]'
                  )}
                  onClick={() => {
                    if (banUserId === u.id) {
                      setBanUserId(null)
                      setBanReason('')
                    } else {
                      setBanUserId(u.id)
                      setBanReason('')
                    }
                  }}
                  disabled={pendingUserIds.has(u.id)}
                >
                  {banUserId === u.id ? 'Cancel' : 'Ban'}
                </Button>
              )}
            </>
          )}
        </span>
      </div>
      {banUserId === u.id && !u.banned && (
        <div className='flex items-center gap-2 pl-[170px]'>
          <ChipInput
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder='Reason (optional)'
            className='flex-1'
          />
          <Button
            variant='primary'
            className='h-[28px] px-3 text-caption'
            onClick={() => {
              banUser.reset()
              banUser.mutate(
                {
                  userId: u.id,
                  ...(banReason.trim() ? { banReason: banReason.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setBanUserId(null)
                    setBanReason('')
                  },
                }
              )
            }}
            disabled={pendingUserIds.has(u.id)}
          >
            Confirm Ban
          </Button>
        </div>
      )}
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
                <Label className='text-[var(--text-primary)] text-sm'>Mothership Environment</Label>
                <p className='text-[var(--text-secondary)] text-xs'>
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

      <div className='flex flex-col gap-3'>
        <p className='font-medium text-[var(--text-muted)] text-small'>User Management</p>
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

        {(setUserRole.error ||
          banUser.error ||
          unbanUser.error ||
          impersonateUser.error ||
          impersonationGuardError) && (
          <p className='text-[var(--text-error)] text-small'>
            {impersonationGuardError ||
              (setUserRole.error || banUser.error || unbanUser.error || impersonateUser.error)
                ?.message ||
              'Action failed. Please try again.'}
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
                    onClick={() => setAdminParams((prev) => ({ offset: prev.offset + PAGE_SIZE }))}
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
    </SettingsPanel>
  )
}
