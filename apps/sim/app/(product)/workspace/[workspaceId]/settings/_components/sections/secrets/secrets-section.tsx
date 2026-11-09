'use client'

import { FailureNotice } from '@sim/emcn/status'
import { useRouter, useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { SecretDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-detail'
import { SecretsEditor } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secrets-editor'
import { useWorkspaceSecrets } from '@/platform/lib/data/secrets'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { platformHref } from '@/platform/lib/navigation'

/** The workspace's and the viewer's secrets, or one secret's details at `secrets/<credentialId>`. */
export default function SecretsSection({ workspaceId, subpath }: WorkspaceSettingsSectionProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [credentialId] = subpath
  const listHref = platformHref(workspacePath(workspaceId, 'settings/secrets'), search)

  if (credentialId)
    return (
      <SecretDetail
        key={credentialId}
        workspaceId={workspaceId}
        credentialId={credentialId}
        onBack={() => router.push(listHref)}
      />
    )
  return (
    <SecretsList
      workspaceId={workspaceId}
      onViewDetails={(id) =>
        router.push(
          platformHref(
            workspacePath(workspaceId, `settings/secrets/${encodeURIComponent(id)}`),
            search
          )
        )
      }
    />
  )
}

interface SecretsListProps {
  workspaceId: string
  onViewDetails: (credentialId: string) => void
}

function SecretsList({ workspaceId, onViewDetails }: SecretsListProps) {
  const { canMutate, permission } = useWorkspaceSettingsSection(workspaceId, 'secrets')
  const secrets = useWorkspaceSecrets(workspaceId, permission === 'admin')

  if (secrets.failed)
    return (
      <FailureNotice
        message='Could not load secrets.'
        retrying={secrets.retrying}
        onRetry={secrets.retry}
      />
    )
  if (!secrets.workspaceVariables || !secrets.personalVariables) return null
  return (
    <SecretsEditor
      workspaceId={workspaceId}
      variables={secrets.workspaceVariables}
      personalVariables={secrets.personalVariables}
      canCreate={canMutate}
      rowAccess={secrets.rowAccess}
      savePersonal={secrets.savePersonal}
      saveWorkspace={secrets.saveWorkspace}
      isSaving={secrets.isSaving}
      onViewDetails={onViewDetails}
    />
  )
}
