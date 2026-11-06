import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LoadingRows } from '@/platform/design-system/components/status/query-boundary'
import { PageSurface } from '@/platform/design-system/components/surface/surface'
import { IntegrationsPage } from '@/platform/embedded/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { SecretsEditor } from '@/platform/embedded/app/(shell)/integrations/_components/secrets-editor/secrets-editor'
import { SettingsSubpageHost } from '@/platform/embedded/app/(shell)/settings/_components/settings-subpage-host'

interface OrganizationSecretsPageProps {
  organizationId: string
  mode: SecretSourceMode
  backHref?: string
}

export async function OrganizationSecretsPage({
  organizationId,
  mode,
  backHref,
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
  const editor = (
    <Suspense fallback={<LoadingRows label='Loading secrets…' />}>
      <SecretsEditor mode={mode} backHref={backHref} />
    </Suspense>
  )
  return mode === 'organization' ? (
    <SettingsSubpageHost section='integrations'>{editor}</SettingsSubpageHost>
  ) : (
    <PageSurface>
      <IntegrationsPage>{editor}</IntegrationsPage>
    </PageSurface>
  )
}
