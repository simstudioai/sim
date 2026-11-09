import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Search' }

/** Search reads company knowledge under the viewer's permissions, so it exists only on live data. */
export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  await connection()
  if (resolvePlatformMode() !== 'live') notFound()
  const [query, { LiveSearchRoute }] = await Promise.all([
    searchParams,
    import(
      '@/app/(product)/o/[organizationId]/search/_components/search-surface/live-search-route'
    ),
  ])
  return <LiveSearchRoute searchParams={query} />
}
