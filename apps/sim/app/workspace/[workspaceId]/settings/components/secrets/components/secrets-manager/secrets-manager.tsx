'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { type SecretRowAccess, SecretsEditor } from '@/components/secrets/secrets-editor'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useRemoveWorkspaceEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'

export function SecretsManager() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
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
  const { data: permissions } = useWorkspacePermissionsQuery(workspaceId || null)
  const queryClient = useQueryClient()
  const isAdmin = permissions?.viewer?.isAdmin ?? false
  const canCreate = canMutateWorkspaceSettingsSection('secrets', {
    canEdit: isAdmin || permissions?.viewer?.permissionType === 'write',
    canAdmin: isAdmin,
  })
  const byKey = new Map(credentials.map((credential) => [credential.envKey, credential]))
  const rowAccess = new Map<string, SecretRowAccess>()
  for (const key of Object.keys(workspace.data?.workspace ?? {})) {
    const credential = byKey.get(key)
    rowAccess.set(key, {
      canEdit: credential?.role === 'admin',
      canReveal: isAdmin || credential?.role === 'admin' || Boolean(credential?.unredacted),
      description: credential?.description,
      ...(credential
        ? { detailsHref: `/workspace/${workspaceId}/settings/secrets/${credential.id}` }
        : {}),
    })
  }
  return (
    <SecretsEditor
      sectionLabel='Workspace'
      workspaceId={workspaceId}
      variables={workspace.data?.workspace}
      canCreate={canCreate}
      rowAccess={rowAccess}
      personal={{
        variables: personal.data,
        save: async (variables) => {
          try {
            await savePersonal.mutateAsync({ variables })
          } finally {
            void queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })
          }
        },
      }}
      save={async ({ upsert, remove }) => {
        try {
          if (Object.keys(upsert).length)
            await upsertWorkspace.mutateAsync({ workspaceId, variables: upsert })
          if (remove.length) await removeWorkspace.mutateAsync({ workspaceId, keys: remove })
        } finally {
          void queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })
        }
      }}
      isLoading={personal.isLoading || workspace.isLoading}
      isSaving={savePersonal.isPending || upsertWorkspace.isPending || removeWorkspace.isPending}
    />
  )
}
