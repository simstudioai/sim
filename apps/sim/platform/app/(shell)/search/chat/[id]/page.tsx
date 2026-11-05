import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export default async function Page({ params }: PageProps<'/search/chat/[id]'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ id }, { LiveSearchRoute }] = await Promise.all([
    params,
    import('@/platform/app/(shell)/search/_components/search-surface/live-search-route'),
  ])
  return <LiveSearchRoute chatId={id} />
}
