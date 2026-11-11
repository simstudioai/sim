'use client'

import { FailureNotice } from '@sim/emcn/status'
import { SecretRows } from '@/app/(product)/_components/secrets-editor/secret-rows'
import { setRecordValue, useWorkspaceSecrets } from '@/platform/lib/data/secrets'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

export interface WorkspaceSecretsProps {
  workspaceId: string
  onViewDetails: (credentialId: string) => void
}

/**
 * The workspace's and the viewer's own secrets, saved together. A personal secret the workspace
 * also names is overridden by it, and a secret named by a `{{` suggestion's "Add secret" arrives
 * as a pending create request.
 */
export function WorkspaceSecrets({ workspaceId, onViewDetails }: WorkspaceSecretsProps) {
  const { canMutate, permission } = useWorkspaceSettingsSection(workspaceId, 'secrets')
  const secrets = useWorkspaceSecrets(workspaceId, permission === 'admin')

  if (secrets.failed)
    return (
      <FailureNotice
        message='Couldn’t load secrets'
        retrying={secrets.retrying}
        onRetry={secrets.retry}
      />
    )
  if (!secrets.workspaceVariables || !secrets.personalVariables) return null
  const personal: Record<string, string> = {}
  for (const { key, value } of Object.values(secrets.personalVariables)) {
    setRecordValue(personal, key, value)
  }
  return (
    <SecretRows
      key={workspaceId}
      isSaving={secrets.isSaving}
      createRequestsFor={workspaceId}
      onViewDetails={onViewDetails}
      scopes={[
        {
          id: 'workspace',
          title: 'Workspace',
          noun: 'workspace',
          variables: secrets.workspaceVariables,
          canCreate: canMutate,
          rowAccess: secrets.rowAccess,
          save: ({ upsert, remove }) => secrets.saveWorkspace({ upsert, remove }),
        },
        {
          id: 'personal',
          title: 'Personal',
          noun: 'personal',
          variables: personal,
          overriddenBy: 0,
          takesCreateRequests: true,
          save: ({ saved }) => secrets.savePersonal(saved),
        },
      ]}
    />
  )
}
