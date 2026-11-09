import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Tool permissions', referrer: 'no-referrer' }

export default async function Page({
  params,
}: ProductPageProps<{ organizationId: string; credentialId: string }>) {
  // Example data has no connected accounts, so only live data serves this page.
  if (resolvePlatformMode() !== 'live') notFound()
  const { LiveAccountToolsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/live-account-tools-route'
  )
  return <LiveAccountToolsRoute credentialId={(await params).credentialId} />
}
