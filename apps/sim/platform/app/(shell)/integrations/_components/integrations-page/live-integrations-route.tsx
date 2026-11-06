import { notFound } from 'next/navigation'
import { IntegrationsRoute } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** The member's own connections, the same page the organization surface embeds. */
export async function LiveIntegrationsRoute({ section }: { section?: string }) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (!organization.searchAccess.memberScoped) notFound()
  return (
    <IntegrationsRoute
      organizationId={organization.organization.id}
      section={section}
      basePath='/integrations'
      memberSecretsPath={legacyRoutes(organization).memberSecrets}
    />
  )
}
