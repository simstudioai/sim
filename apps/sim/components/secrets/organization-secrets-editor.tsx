'use client'

import { ArrowLeft } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { SecretsEditor } from '@/components/secrets/secrets-editor'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  useOrganizationSecrets,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'

interface OrganizationSecretsEditorProps {
  mode: SecretSourceMode
}

export function OrganizationSecretsEditor({ mode }: OrganizationSecretsEditorProps) {
  const { organization, viewer } = useOrganizationContext()
  const router = useRouter()
  useSettingsBeforeUnload()
  const secrets = useOrganizationSecrets(organization.id, mode, mode === 'member' || viewer.isAdmin)
  const save = useSaveOrganizationSecrets(organization.id)
  const routes = organizationRoutes(organization.id)
  const back =
    mode === 'organization'
      ? { text: 'Sources', href: routes.settingsSection('integrations') }
      : { text: 'Integrations', href: routes.integrations }
  if (!secrets.data || secrets.error)
    return (
      <SettingsPanel
        title='Generic Secrets'
        back={{ text: back.text, icon: ArrowLeft, onSelect: () => router.push(back.href) }}
      >
        {secrets.error ? (
          <SettingsQueryErrorState
            error={secrets.error}
            fallback='Could not load secrets'
            isRetrying={secrets.isFetching}
            onRetry={() => void secrets.refetch()}
            variant='inline'
          />
        ) : (
          <SettingsEmptyState variant='inline'>Loading secrets…</SettingsEmptyState>
        )}
      </SettingsPanel>
    )
  const data = secrets.data
  return (
    <SecretsEditor
      key={data.source.id}
      back={back}
      sectionLabel={mode === 'organization' ? 'Organization' : 'Personal'}
      variables={data.variables}
      canCreate
      save={(changes) => save.mutateAsync({ ...changes, sourceId: data.source.id, mode })}
      isLoading={false}
      isSaving={save.isPending}
    />
  )
}
