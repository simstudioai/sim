'use client'

import { useQueryClient } from '@tanstack/react-query'
import type { SecretChanges } from '@/lib/organization-secrets/validation'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useRemoveWorkspaceEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'

/** What the viewer may do with one workspace secret row, and the credential behind it. */
export interface SecretRowAccess {
  canEdit: boolean
  canReveal: boolean
  description?: string | null
  credentialId?: string
}

/**
 * The workspace's and the viewer's own secrets, with the access each workspace row grants and the
 * saves the editor commits through. Saves refresh the credential list either way, as the legacy
 * secrets manager does, so a new key gains its details link.
 */
export function useWorkspaceSecrets(workspaceId: string, isAdmin: boolean) {
  const personal = usePersonalEnvironment()
  const workspace = useWorkspaceEnvironment(workspaceId)
  const savePersonal = useSavePersonalEnvironment()
  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const removeWorkspace = useRemoveWorkspaceEnvironment()
  const { data: credentials = [] } = useWorkspaceCredentials({
    workspaceId,
    type: 'env_workspace',
    enabled: Boolean(workspaceId),
  })
  const queryClient = useQueryClient()
  const refreshCredentials = () =>
    void queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })

  const byKey = new Map(credentials.map((credential) => [credential.envKey, credential]))
  const rowAccess = new Map<string, SecretRowAccess>()
  for (const key of Object.keys(workspace.data?.workspace ?? {})) {
    const credential = byKey.get(key)
    rowAccess.set(key, {
      canEdit: credential?.role === 'admin',
      canReveal: isAdmin || credential?.role === 'admin' || Boolean(credential?.unredacted),
      description: credential?.description,
      credentialId: credential?.id,
    })
  }

  return {
    personalVariables: personal.data,
    workspaceVariables: workspace.data?.workspace,
    rowAccess,
    failed: personal.isError || workspace.isError,
    retrying: personal.isFetching || workspace.isFetching,
    retry: () => {
      if (personal.isError) void personal.refetch()
      if (workspace.isError) void workspace.refetch()
    },
    isSaving: savePersonal.isPending || upsertWorkspace.isPending || removeWorkspace.isPending,
    savePersonal: async (variables: Record<string, string>) => {
      try {
        await savePersonal.mutateAsync({ variables })
      } finally {
        refreshCredentials()
      }
    },
    saveWorkspace: async ({ upsert, remove }: SecretChanges) => {
      try {
        if (Object.keys(upsert).length)
          await upsertWorkspace.mutateAsync({ workspaceId, variables: upsert })
        if (remove.length) await removeWorkspace.mutateAsync({ workspaceId, keys: remove })
      } finally {
        refreshCredentials()
      }
    },
  }
}

/** The workflow editor's focused-block URL parameter, as `focus-block-deep-link` reads it. */
export const FOCUS_BLOCK_PARAM = 'block'
