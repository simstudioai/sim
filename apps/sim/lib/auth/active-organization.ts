import { headers } from 'next/headers'
import { auth } from './auth'

export async function setActiveOrganizationForCurrentSession(
  organizationId: string | null
): Promise<void> {
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  })
}
