import type { SessionPrincipal } from '@sim/auth/principal'
import { resolveSessionOrganizationLanding } from '@/lib/organizations/surface'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'

/**
 * The organization whose links `sim/` opens for this session: where the session lands, or `null`
 * when it belongs to none or Sim links are off there. Following a link and suggesting one both
 * read this, so a suggestion always resolves where it is followed.
 */
export async function resolveSimLinkOrganization(
  principal: SessionPrincipal
): Promise<string | null> {
  const organizationId = await resolveSessionOrganizationLanding(principal)
  return organizationId && (await isSimLinksEnabled(organizationId)) ? organizationId : null
}
