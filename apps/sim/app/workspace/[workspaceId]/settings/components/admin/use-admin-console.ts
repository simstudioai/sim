'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import type { MothershipEnvironment } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import {
  adminParsers,
  adminUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/admin/search-params'
import { useRecentImpersonations } from '@/app/workspace/[workspaceId]/settings/components/admin/use-recent-impersonations'
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
import { useBenchmarkAvailability } from '@/hooks/queries/benchmarks'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useImportWorkflow } from '@/hooks/queries/workflows'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import { clearUserData } from '@/stores'

export const ADMIN_PAGE_SIZE = 20 as const
const PAGE_SIZE = ADMIN_PAGE_SIZE

/**
 * The row action awaiting confirmation. Holds ids, never the user row, so a
 * refetch while the modal is open refreshes the name it shows without
 * redirecting the action the admin committed to.
 */
type PendingUserAction =
  | { type: 'ban'; userId: string }
  | { type: 'role'; userId: string; nextRole: 'admin' | 'user' }

export const MOTHERSHIP_ENV_OPTIONS: { value: MothershipEnvironment; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
]

interface UseAdminConsoleOptions {
  /** Told of a failed impersonation or workflow import, for a surface that reports them as events. */
  onActionError?: (message: string) => void
}

/** Platform administration: settings, workflow import, and user management. */
export function useAdminConsole({ onActionError }: UseAdminConsoleOptions = {}) {
  const { data: session } = useSession()

  const { data: settings } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()
  const benchmarkAvailability = useBenchmarkAvailability(Boolean(settings?.superUserModeEnabled))
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
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null)
  const isImpersonating = impersonatingUserId !== null || impersonateUser.isPending
  const discardImport = () => {
    setWorkflowId('')
    setTargetWorkspaceId('')
  }
  const importGuard = useSettingsUnsavedGuard({
    isDirty: Boolean(workflowId.trim() || targetWorkspaceId.trim()),
    navigationBlocked: importWorkflow.isPending || isImpersonating,
    onDiscard: discardImport,
  })

  const [{ q: searchQuery, offset: usersOffset }, setAdminParams] = useQueryStates(
    adminParsers,
    adminUrlKeys
  )

  const [searchInput, setSearchInput] = useState(searchQuery)
  const [pendingAction, setPendingAction] = useState<PendingUserAction | null>(null)
  const [banReason, setBanReason] = useState('')
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

  const [syncedSearchQuery, setSyncedSearchQuery] = useState(searchQuery)
  if (searchQuery !== syncedSearchQuery) {
    setSyncedSearchQuery(searchQuery)
    setSearchInput(searchQuery)
  }

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
    if (isImpersonating || importWorkflow.isPending) return
    setImpersonationGuardError(null)
    if (session?.user?.role !== 'admin') {
      setImpersonatingUserId(null)
      setImpersonationGuardError('Only admins can impersonate users.')
      onActionError?.('Only admins can impersonate users.')
      return
    }

    importGuard.guardBack(() => {
      setImpersonatingUserId(userId)
      impersonateUser.reset()
      impersonateUser.mutate(
        { userId },
        {
          onError: (error) => {
            setImpersonatingUserId(null)
            onActionError?.(error.message)
          },
          onSuccess: async () => {
            recordImpersonation(email)
            await clearUserData({ preserveRecentImpersonations: true })
            window.location.assign(APP_ENTRY_PATH)
          },
        }
      )
    })
  }

  const handleImport = () => {
    const sourceId = workflowId.trim()
    const targetId = targetWorkspaceId.trim()
    if (!sourceId || !targetId || importWorkflow.isPending || isImpersonating) return
    importWorkflow.mutate(
      { workflowId: sourceId, targetWorkspaceId: targetId },
      {
        onSuccess: discardImport,
        onError: (error) => onActionError?.(error.message),
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

  /** Settles with the ban, for a dialog to hold on. A refusal stays on `banUser.error`. */
  const handleConfirmBan = async () => {
    if (pendingAction?.type !== 'ban') return
    const trimmedReason = banReason.trim()
    try {
      await banUser.mutateAsync({
        userId: pendingAction.userId,
        ...(trimmedReason ? { banReason: trimmedReason } : {}),
      })
      closePendingAction()
    } catch {
      return
    }
  }

  /** Settles with the change, for a dialog to hold on. A refusal stays on `setUserRole.error`. */
  const handleConfirmRoleChange = async () => {
    if (pendingAction?.type !== 'role') return
    try {
      await setUserRole.mutateAsync({ userId: pendingAction.userId, role: pendingAction.nextRole })
      closePendingAction()
    } catch {
      return
    }
  }

  const pendingUserIds = new Set<string>()
  for (const mutation of [setUserRole, banUser, unbanUser, impersonateUser, sendPasswordReset]) {
    if (mutation.isPending && mutation.variables?.userId)
      pendingUserIds.add(mutation.variables.userId)
  }
  if (impersonatingUserId) pendingUserIds.add(impersonatingUserId)

  const sendReset = (user: AdminUser) => {
    setProvisionWarning(null)
    sendPasswordReset.mutate(
      { userId: user.id, email: user.email },
      {
        onSuccess: () => toast.success(`Password reset email sent to ${user.email}`),
        onError: (error) =>
          toast.error(
            getErrorMessage(error, `Could not send a password reset email to ${user.email}`)
          ),
      }
    )
  }
  const startRoleChange = (user: AdminUser) => {
    setUserRole.reset()
    setPendingAction({
      type: 'role',
      userId: user.id,
      nextRole: user.role === 'admin' ? 'user' : 'admin',
    })
  }
  const startBan = (user: AdminUser) => {
    banUser.reset()
    setBanReason('')
    setPendingAction({ type: 'ban', userId: user.id })
  }
  const handleUserCreated = (user: AdminUser, resetEmailError?: string) => {
    // Search for the new user either way: when the reset email failed,
    // the recovery action named below lives on that user's row.
    setSearchInput(user.email)
    setAdminParams({ q: user.email, offset: null })
    setProvisionWarning(
      resetEmailError
        ? `Created ${user.email}, but the password reset email failed to send (${resetEmailError}). Use Reset password in that row's actions menu to try again.`
        : null
    )
  }
  return {
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
  }
}
