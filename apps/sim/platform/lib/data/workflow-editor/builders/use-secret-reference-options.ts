import { useCallback, useMemo } from 'react'
import { writePendingCredentialCreateRequest } from '@/lib/credentials/client-state'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

/** A secret a field may reference, stored as its whole `{{NAME}}` reference. */
export interface SecretReferenceOption {
  label: string
  value: string
}

interface UseSecretReferenceOptionsProps {
  workspaceId: string | undefined
}

/**
 * The workspace's and viewer's secret names as `{{NAME}}` references, for a field that may hold only
 * a reference, and the way to the Secrets settings to create one.
 */
export function useSecretReferenceOptions({ workspaceId }: UseSecretReferenceOptionsProps) {
  const { navigateToSettings } = useSettingsNavigation()
  const { data: personalEnv = {} } = usePersonalEnvironment()
  const { data: workspaceEnv } = useWorkspaceEnvironment(workspaceId ?? '', {
    enabled: Boolean(workspaceId),
  })

  const options = useMemo((): SecretReferenceOption[] => {
    const names = workspaceId
      ? [
          ...Object.keys(workspaceEnv?.workspace ?? {}),
          ...Object.keys(workspaceEnv?.personal ?? {}),
        ]
      : Object.keys(personalEnv)
    return [...new Set(names)].map((name) => ({ label: name, value: `{{${name}}}` }))
  }, [workspaceId, workspaceEnv, personalEnv])

  const openCreateSecret = useCallback(() => {
    if (workspaceId) {
      writePendingCredentialCreateRequest({
        workspaceId,
        type: 'env_personal',
        requestedAt: Date.now(),
      })
    }
    navigateToSettings({ section: 'secrets' })
  }, [workspaceId, navigateToSettings])

  return { options, openCreateSecret }
}
