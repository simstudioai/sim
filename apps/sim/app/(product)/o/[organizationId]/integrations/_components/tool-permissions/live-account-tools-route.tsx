import { notFound } from 'next/navigation'
import { IntegrationsPage } from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { ToolPermissionsPanel } from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions-panel'
import { integrationsMode } from '@/platform/lib/data/integrations-mode'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** One connected account's tool permissions, as its own page under Integrations. */
export async function LiveAccountToolsRoute({ credentialId }: { credentialId: string }) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const { organization } = surface
  // Member-scoped accounts are Enterprise's; other organizations have no such page.
  if (integrationsMode(organization) !== 'member') notFound()
  return (
    <IntegrationsPage
      back={{ href: surfaceHref(organization, '/integrations'), label: 'Integrations' }}
    >
      <ToolPermissionsPanel
        organizationId={organization.organization.id}
        credentialId={credentialId}
        showHeading
      />
    </IntegrationsPage>
  )
}
