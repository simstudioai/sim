'use client'

import { useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { MothershipEnvironment } from '@/lib/api/contracts/user'
import { clearBrowserUserData, RECENT_IMPERSONATIONS_STORAGE_KEY } from '@/lib/auth/browser-storage'
import { useSession } from '@/lib/auth/client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import {
  type AdminUser,
  useAddUser,
  useAdminUsers,
  useAdminUsersByEmails,
  useBanUser,
  useImpersonateUser,
  useSendPasswordReset,
  useSetUserRole,
  useUnbanUser,
} from '@/hooks/queries/admin-users'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useImportWorkflow } from '@/hooks/queries/workflow-import'
import { useClientStored } from '@/hooks/use-client-stored'
import type { AdminConsole, DirectoryUser, NewDirectoryUser } from '@/platform/lib/data/admin-model'

const MAX_RECENT = 5

function readStoredRecentEmails(): string | null {
  try {
    return localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY)
  } catch {
    return null
  }
}

function parseRecentEmails(stored: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is string => typeof e === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function recordImpersonation(email: string) {
  const recent = parseRecentEmails(readStoredRecentEmails())
  const next = [email, ...recent.filter((e) => e !== email)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

function toDirectoryUser(user: AdminUser): DirectoryUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
    banned: user.banned,
  }
}

/**
 * Platform administration on live data: the viewer's admin settings, the superuser workflow import,
 * and the user directory, over the same queries and mutations the legacy console used. The search
 * and page come from the URL, which the directory owns.
 */
export function useLiveAdminConsole(
  search: { q: string; offset: number; limit: number },
  benchmarkAvailable: boolean
): AdminConsole {
  const { data: session } = useSession()
  const settings = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()
  const importWorkflow = useImportWorkflow()
  const setUserRole = useSetUserRole()
  const banUser = useBanUser()
  const unbanUser = useUnbanUser()
  const impersonateUser = useImpersonateUser()
  const sendPasswordReset = useSendPasswordReset()
  const addUser = useAddUser()
  const storedRecentEmails = useClientStored(readStoredRecentEmails, null)
  const recentEmails = useMemo(() => parseRecentEmails(storedRecentEmails), [storedRecentEmails])
  const recent = useAdminUsersByEmails(recentEmails)
  const users = useAdminUsers(search.offset, search.limit, search.q)
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null)
  const [warning, setWarning] = useState<string>()
  const impersonating = impersonatingUserId !== null || impersonateUser.isPending

  const pendingUserIds = new Set<string>()
  for (const mutation of [setUserRole, banUser, unbanUser, impersonateUser, sendPasswordReset]) {
    if (mutation.isPending && mutation.variables?.userId)
      pendingUserIds.add(mutation.variables.userId)
  }
  if (impersonatingUserId) pendingUserIds.add(impersonatingUserId)

  const settingsData = settings.data
  function saveSetting(
    change:
      | { key: 'superUserModeEnabled'; value: boolean }
      | { key: 'mothershipEnvironment'; value: MothershipEnvironment }
  ) {
    if (updateSetting.isPending || settingsData?.[change.key] === change.value) return
    updateSetting.mutate(change, {
      onError: (error) => toast.error(getErrorMessage(error, 'Could not save the admin setting')),
    })
  }

  return {
    settings: settingsData
      ? {
          superUserModeEnabled: settingsData.superUserModeEnabled,
          mothershipEnvironment: settingsData.mothershipEnvironment,
        }
      : settings.error
        ? null
        : undefined,
    retrySettings: () => void settings.refetch(),
    savingSetting: updateSetting.isPending,
    setSuperUserMode: (value) => saveSetting({ key: 'superUserModeEnabled', value }),
    setMothershipEnvironment: (value) => saveSetting({ key: 'mothershipEnvironment', value }),
    benchmarkAvailable,
    importer: {
      placeholders: { workflow: 'Source workflow ID', target: 'Target workspace ID' },
      pending: importWorkflow.isPending,
      blocked: impersonating,
      notice: importWorkflow.isSuccess
        ? {
            message: `Workflow imported (new ID: ${importWorkflow.data.newWorkflowId}, ${importWorkflow.data.copilotChatsImported ?? 0} copilot chats imported)`,
          }
        : undefined,
      reset: () => importWorkflow.reset(),
      submit: async ({ workflow, target }) => {
        try {
          await importWorkflow.mutateAsync({
            workflowId: workflow.trim(),
            targetWorkspaceId: target.trim(),
          })
          return true
        } catch (error) {
          toast.error(getErrorMessage(error, 'Could not import the workflow'))
          return false
        }
      },
    },
    directory: {
      operatorId: session?.user?.id,
      results: users.data
        ? { users: users.data.users.map(toDirectoryUser), total: users.data.total }
        : undefined,
      searching: users.isLoading,
      error: users.error ? getErrorMessage(users.error, 'Failed to fetch users') : undefined,
      warning,
      status: impersonating
        ? 'Switching to that user…'
        : sendPasswordReset.isPending && sendPasswordReset.variables
          ? `Sending a password reset email to ${sendPasswordReset.variables.email}...`
          : undefined,
      recent: recent.data?.map(toDirectoryUser) ?? [],
      impersonating,
      busy: (userId) => pendingUserIds.has(userId),
      impersonate: (user) => {
        if (impersonating || importWorkflow.isPending) return
        if (session?.user?.role !== 'admin') {
          toast.error('Only admins can impersonate users.')
          return
        }
        setImpersonatingUserId(user.id)
        impersonateUser.reset()
        impersonateUser.mutate(
          { userId: user.id },
          {
            onError: (error) => {
              setImpersonatingUserId(null)
              toast.error(error.message)
            },
            onSuccess: () => {
              recordImpersonation(user.email)
              clearBrowserUserData({ preserveRecentImpersonations: true })
              window.location.assign(APP_ENTRY_PATH)
            },
          }
        )
      },
      resetPassword: (user) => {
        setWarning(undefined)
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
      },
      setRole: async (user, role) => {
        await setUserRole.mutateAsync({ userId: user.id, role })
      },
      ban: async (user, reason) => {
        await banUser.mutateAsync({ userId: user.id, ...(reason ? { banReason: reason } : {}) })
      },
      unban: (user) =>
        unbanUser.mutate({ userId: user.id }, { onError: (error) => toast.error(error.message) }),
      addUser: async (input: NewDirectoryUser) => {
        const { user, resetEmailError } = await addUser.mutateAsync(input)
        setWarning(
          resetEmailError
            ? `Created ${user.email}, but the password reset email failed to send (${resetEmailError}). Use Reset password in that row's actions menu to try again.`
            : undefined
        )
        return user.email
      },
    },
  }
}
