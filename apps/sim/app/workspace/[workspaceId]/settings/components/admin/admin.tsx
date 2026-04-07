'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Badge, Button, Input as EmcnInput, Label, Skeleton, Switch } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  useAdminUsers,
  useBanUser,
  useImpersonateUser,
  useSetUserRole,
  useUnbanUser,
} from '@/hooks/queries/admin-users'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useImportWorkflow } from '@/hooks/queries/workflows'

const PAGE_SIZE = 20 as const

export function Admin() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const { data: session } = useSession()

  const { data: settings } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()
  const importWorkflow = useImportWorkflow()

  const setUserRole = useSetUserRole()
  const banUser = useBanUser()
  const unbanUser = useUnbanUser()
  const impersonateUser = useImpersonateUser()

  const [workflowId, setWorkflowId] = useState('')
  const [usersOffset, setUsersOffset] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
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
    setUsersOffset(0)
    setSearchQuery(searchInput.trim())
  }

  const totalPages = useMemo(
    () => Math.ceil((usersData?.total ?? 0) / PAGE_SIZE),
    [usersData?.total]
  )
  const currentPage = useMemo(() => Math.floor(usersOffset / PAGE_SIZE) + 1, [usersOffset])

  const handleSuperUserModeToggle = async (checked: boolean) => {
    if (checked !== settings?.superUserModeEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'superUserModeEnabled', value: checked })
    }
  }

  const handleImport = () => {
    if (!workflowId.trim()) return
    importWorkflow.mutate(
      { workflowId: workflowId.trim(), targetWorkspaceId: workspaceId },
      { onSuccess: () => setWorkflowId('') }
    )
  }

  const handleImpersonate = (userId: string) => {
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
        onSuccess: () => {
          window.location.assign('/workspace')
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
  return (
    <div className='flex h-full flex-col gap-6'>
      <div className='flex items-center justify-between'>
        <Label htmlFor='super-user-mode'>Super admin mode</Label>
        <Switch
          id='super-user-mode'
          checked={settings?.superUserModeEnabled ?? false}
          onCheckedChange={handleSuperUserModeToggle}
        />
      </div>

      <div className='h-px bg-[var(--border-secondary)]' />

      <div className='flex flex-col gap-2'>
        <p className='text-[var(--text-secondary)] text-sm'>
          Import a workflow by ID along with its associated copilot chats.
        </p>
        <div className='flex gap-2'>
          <EmcnInput
            value={workflowId}
            onChange={(e) => {
              setWorkflowId(e.target.value)
              importWorkflow.reset()
            }}
            placeholder='Enter workflow ID'
            disabled={importWorkflow.isPending}
          />
          <Button
            variant='primary'
            onClick={handleImport}
            disabled={importWorkflow.isPending || !workflowId.trim()}
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

      <div className='h-px bg-[var(--border-secondary)]' />

      <div className='flex flex-col gap-3'>
        <p className='font-medium text-[var(--text-primary)] text-sm'>User Management</p>
        <div className='flex gap-2'>
          <EmcnInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder='Search by email or paste a user ID...'
          />
          <Button variant='primary' onClick={handleSearch} disabled={usersLoading}>
            {usersLoading ? 'Searching...' : 'Search'}
          </Button>
        </div>

        {usersError && (
          <p className='text-[var(--text-error)] text-small'>
            {usersError instanceof Error ? usersError.message : 'Failed to fetch users'}
          </p>
        )}

        {(setUserRole.error ||
          banUser.error ||
          unbanUser.error ||
          impersonateUser.error ||
          impersonationGuardError) && (
          <p className='text-[13px] text-[var(--text-error)]'>
            {impersonationGuardError ||
              (setUserRole.error || banUser.error || unbanUser.error || impersonateUser.error)
                ?.message ||
              'Action failed. Please try again.'}
          </p>
        )}

        {usersLoading && !usersData && (
          <div className='flex flex-col gap-2'>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className='h-[48px] w-full rounded-md' />
            ))}
          </div>
        )}

        {searchQuery.length > 0 && usersData && (
          <>
            <div className='flex flex-col gap-0.5'>
              <div className='flex items-center gap-3 border-[var(--border-secondary)] border-b px-3 py-2 text-[var(--text-tertiary)] text-caption'>
                <span className='w-[200px]'>Name</span>
                <span className='flex-1'>Email</span>
                <span className='w-[80px]'>Role</span>
                <span className='w-[80px]'>Status</span>
                <span className='w-[250px] text-right'>Actions</span>
              </div>

              {usersData.users.length === 0 && (
                <div className='py-4 text-center text-[var(--text-tertiary)] text-small'>
                  No users found.
                </div>
              )}

              {usersData.users.map((u) => (
                <div
                  key={u.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 text-small',
                    'border-[var(--border-secondary)] border-b last:border-b-0'
                  )}
                >
                  <span className='w-[200px] truncate text-[var(--text-primary)]'>
                    {u.name || '—'}
                  </span>
                  <span className='flex-1 truncate text-[var(--text-secondary)]'>{u.email}</span>
                  <span className='w-[80px]'>
                    <Badge variant={u.role === 'admin' ? 'blue' : 'gray'}>{u.role || 'user'}</Badge>
                  </span>
                  <span className='w-[80px]'>
                    {u.banned ? (
                      <Badge variant='red'>Banned</Badge>
                    ) : (
                      <Badge variant='green'>Active</Badge>
                    )}
                  </span>
                  <span className='flex w-[250px] justify-end gap-1'>
                    {u.id !== session?.user?.id && (
                      <>
                        <Button
                          variant='active'
                          className='h-[28px] px-2 text-[12px]'
                          onClick={() => handleImpersonate(u.id)}
                          disabled={pendingUserIds.has(u.id)}
                        >
                          {impersonatingUserId === u.id ||
                          (impersonateUser.isPending &&
                            (impersonateUser.variables as { userId?: string } | undefined)
                              ?.userId === u.id)
                            ? 'Switching...'
                            : 'Impersonate'}
                        </Button>
                        <Button
                          variant='active'
                          className='h-[28px] px-2 text-[12px]'
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
                        ) : banUserId === u.id ? (
                          <div className='flex gap-1'>
                            <EmcnInput
                              value={banReason}
                              onChange={(e) => setBanReason(e.target.value)}
                              placeholder='Reason (optional)'
                              className='h-[28px] w-[120px] text-caption'
                            />
                            <Button
                              variant='primary'
                              className='h-[28px] px-2 text-caption'
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
                              Confirm
                            </Button>
                            <Button
                              variant='active'
                              className='h-[28px] px-2 text-caption'
                              onClick={() => {
                                setBanUserId(null)
                                setBanReason('')
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant='active'
                            className='h-[28px] px-2 text-[var(--text-error)] text-caption'
                            onClick={() => {
                              setBanUserId(u.id)
                              setBanReason('')
                            }}
                            disabled={pendingUserIds.has(u.id)}
                          >
                            Ban
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </div>
              ))}
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
                    onClick={() => setUsersOffset((prev) => prev - PAGE_SIZE)}
                    disabled={usersOffset === 0 || usersLoading}
                  >
                    Previous
                  </Button>
                  <Button
                    variant='active'
                    className='h-[28px] px-2 text-caption'
                    onClick={() => setUsersOffset((prev) => prev + PAGE_SIZE)}
                    disabled={usersOffset + PAGE_SIZE >= (usersData?.total ?? 0) || usersLoading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
