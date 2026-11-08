import { redirect } from 'next/navigation'
import { platformHref } from '@/platform/lib/navigation'

/**
 * Legacy hooks send a usage limit's Upgrade action to the workspace's upgrade page. The zone's plans
 * live in the organization's billing settings, so the route forwards there.
 */
export default async function Page({
  searchParams,
}: PageProps<'/workspace/[workspaceId]/upgrade'>) {
  const query = await searchParams
  redirect(
    platformHref('/settings/billing', {
      get: (key) => (typeof query[key] === 'string' ? query[key] : null),
    })
  )
}
