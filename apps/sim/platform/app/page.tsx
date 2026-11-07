import { redirect } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref } from '@/platform/lib/navigation'

export default async function Page({ searchParams }: PageProps<'/'>) {
  const query = await searchParams
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') search.set(key, value)
  }
  if (resolvePlatformMode() !== 'live' && search.has('recipe')) redirect(`/workbench?${search}`)
  if (resolvePlatformMode() === 'live') {
    const { resolveLiveLanding } = await import('@/platform/lib/data/landing')
    redirect(await resolveLiveLanding())
  }
  redirect(platformHref('/home', search))
}
