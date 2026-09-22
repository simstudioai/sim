import { redirect } from 'next/navigation'
import {
  getAccessRequestsSettingsHref,
  getLegacyAccessRequestsSettingsQuery,
} from '@/ee/access-requests/lib/navigation'

interface AccessRequestsPageProps {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AccessRequestsPage({
  params,
  searchParams,
}: AccessRequestsPageProps) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  redirect(
    getAccessRequestsSettingsHref({ kind: 'workspace', workspaceId }) +
      getLegacyAccessRequestsSettingsQuery(query)
  )
}
