import { redirect } from 'next/navigation'
import { platformHref } from '@/platform/lib/navigation'

/**
 * Legacy hooks send a usage limit's Upgrade action to the workspace's upgrade page. The zone's plans
 * belong to the organization's billing, so the route forwards there with the limit that sent it.
 */
export default async function Page({
  searchParams,
}: PageProps<'/workspace/[workspaceId]/upgrade'>) {
  const query = await searchParams
  const reason =
    typeof query.reason === 'string' ? `?reason=${encodeURIComponent(query.reason)}` : ''
  redirect(
    platformHref(`/settings/billing/plans${reason}`, {
      get: (key) => (typeof query[key] === 'string' ? query[key] : null),
    })
  )
}
