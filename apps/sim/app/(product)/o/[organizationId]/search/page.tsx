import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Search' }

/** Search reads company knowledge under the viewer's permissions, so it exists only on live data. */
export default async function Page() {
  await connection()
  if (resolvePlatformMode() !== 'live') notFound()
  const { LiveSearchRoute } = await import(
    '@/app/(product)/o/[organizationId]/search/_components/search-surface/live-search-route'
  )
  return <LiveSearchRoute />
}
