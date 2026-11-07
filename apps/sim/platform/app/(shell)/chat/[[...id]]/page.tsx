import { notFound } from 'next/navigation'
import { FixtureChatScreen } from '@/platform/app/(shell)/_components/chat/conversation/fixture-chat-screen'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'

export default async function Page({ searchParams, params }: PageProps<'/chat/[[...id]]'>) {
  const [query, { id }] = await Promise.all([searchParams, params])
  if (id && id.length !== 1) notFound()
  if (resolvePlatformMode() === 'live') {
    // Loaded only here, so a fixture server never evaluates the chat seam.
    const { LiveChatRoute } = await import(
      '@/platform/app/(shell)/_components/chat/live/live-chat-route'
    )
    return <LiveChatRoute chatId={id?.[0]} />
  }
  return <FixtureChatScreen scenario={readScenario(query.state)} chatId={id?.[0]} />
}
