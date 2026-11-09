import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Tool permissions', referrer: 'no-referrer' }

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ organizationId: string; credentialId: string }>) {
  // Example data has no connected accounts, so only live data serves this page.
  if (resolvePlatformMode() !== 'live') notFound()
  const { LiveAccountToolsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/live-account-tools-route'
  )
  const [{ credentialId }, query] = await Promise.all([params, searchParams])
  const workspace = Array.isArray(query.workspace) ? query.workspace[0] : query.workspace
  return <LiveAccountToolsRoute credentialId={credentialId} workspace={workspace} />
}
