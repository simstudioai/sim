import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Assistant Search' }

export default async function Page({
  params,
}: ProductPageProps<{ organizationId: string; id: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ id }, { LiveSearchRoute }] = await Promise.all([
    params,
    import(
      '@/app/(product)/o/[organizationId]/search/_components/search-surface/live-search-route'
    ),
  ])
  return <LiveSearchRoute chatId={id} />
}
