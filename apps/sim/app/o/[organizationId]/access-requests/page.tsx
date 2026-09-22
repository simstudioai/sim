import { redirect } from 'next/navigation'
import {
  getAccessRequestsSettingsHref,
  getLegacyAccessRequestsSettingsQuery,
} from '@/ee/access-requests/lib/navigation'

interface AccessRequestsPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AccessRequestsPage({
  params,
  searchParams,
}: AccessRequestsPageProps) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams])
  redirect(
    getAccessRequestsSettingsHref({ kind: 'organization', organizationId }) +
      getLegacyAccessRequestsSettingsQuery(query)
  )
}
