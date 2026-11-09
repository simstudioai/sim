import { redirect } from 'next/navigation'
import { accessRequestsSettingsUrl } from '@/platform/lib/data/access-requests-entry'

interface AccessRequestsPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Access requests moved into organization Settings; requester and email links still name this. */
export default async function AccessRequestsPage({
  params,
  searchParams,
}: AccessRequestsPageProps) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams])
  redirect(accessRequestsSettingsUrl(organizationId, query))
}
