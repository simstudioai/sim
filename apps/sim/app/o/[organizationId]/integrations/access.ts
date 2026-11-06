import { notFound } from 'next/navigation'
import { requireOrganizationViewer } from '@/app/o/[organizationId]/viewer'

/**
 * The gate the integrations index and provider pages share. `callbackUrl` is the page to come back to after
 * sign-in, carrying whatever connection or Slack context the visit arrived with.
 */
export async function requireIntegrationsViewer(organizationId: string, callbackUrl: string) {
  const { principal, surface } = await requireOrganizationViewer(organizationId, callbackUrl)
  if (!surface.searchAccess.memberScoped) notFound()
  return { principal, surface }
}
