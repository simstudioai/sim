import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { SecretsEditor } from '@/platform/app/(shell)/integrations/_components/secrets-editor/secrets-editor'
import { LoadingState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { SettingsSubpageHost } from '@/platform/app/(shell)/settings/_components/settings-subpage-host'

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
    <Suspense fallback={<LoadingState label='Loading secrets…' />}>
      <SecretsEditor mode={mode} backHref={backHref} />
    </Suspense>
  )
  return mode === 'organization' ? (
    <SettingsSubpageHost section='integrations'>{editor}</SettingsSubpageHost>
  ) : (
    <IntegrationsHost>
      <IntegrationsPage>{editor}</IntegrationsPage>
    </IntegrationsHost>
  )
}
