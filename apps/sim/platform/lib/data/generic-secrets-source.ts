import 'server-only'
import { createLoader } from 'nuqs/server'
import { getSecretSourceContract } from '@/lib/api/contracts/organization-secrets'
import { readOrganizationSecretSource } from '@/lib/organization-secrets/application/use-cases'
import {
  integrationSearchParsers,
  serializeIntegrationView,
} from '@/lib/organizations/integrations-search-params'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'

const loadIntegrationSearch = createLoader(integrationSearchParsers)

/** How the organization keeps its Generic Secrets, or `null` when it has no such source. */
export async function readGenericSecretSourceMode(organizationId: string) {
  const { principal } = await requireSessionViewer()
  const { source } = await asRouteResponse(
    getSecretSourceContract,
    await readOrganizationSecretSource.execute({ principal, input: { organizationId } })
  )
  return source?.mode ?? null
}

/** The Integrations list a member's secrets lead back to, keeping the search they came from. */
export function integrationsListHref(
  scope: SurfaceScope,
  searchParams: Record<string, string | string[] | undefined>
) {
  const { q } = loadIntegrationSearch(searchParams)
  return serializeIntegrationView(surfaceHref(scope, '/integrations'), { q })
}
