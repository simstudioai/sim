import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { OrganizationSecretsEditor } from '@/components/secrets/organization-secrets-editor'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

interface OrganizationSecretsPageProps {
  organizationId: string
  mode: SecretSourceMode
}

export async function OrganizationSecretsPage({
  organizationId,
  mode,
}: OrganizationSecretsPageProps) {
  const routes = organizationRoutes(organizationId)
  const session = await getSession()
  if (!session?.user || !session.session?.id)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: mode === 'organization' ? routes.organizationSecrets : routes.memberSecrets,
        isInviteFlow: false,
      })
    )
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context || (mode === 'organization' && !context.viewer.isAdmin)) notFound()
  const { source } = await readOrganizationSecretSource.execute({
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
    input: { organizationId },
  })
  if (source?.mode !== mode)
    redirect(mode === 'organization' ? routes.settingsSection('integrations') : routes.integrations)
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={{ title: 'Generic Secrets' }}>
        <Suspense
          fallback={<SettingsEmptyState variant='inline'>Loading secrets…</SettingsEmptyState>}
        >
          <OrganizationSecretsEditor mode={mode} />
        </Suspense>
      </SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
