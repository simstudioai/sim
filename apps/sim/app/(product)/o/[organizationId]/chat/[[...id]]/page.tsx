import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Chat' }

export default async function Page({
  searchParams,
  params,
}: ProductPageProps<{ organizationId: string; id?: string[] }>) {
  const [query, { id }] = await Promise.all([searchParams, params])
  if (id && id.length !== 1) notFound()
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { FixtureChatScreen } = await import(
      '@/app/(product)/_components/chat/conversation/fixture-chat-screen'
    )
    return <FixtureChatScreen scenario={readScenario(query.state)} chatId={id?.[0]} />
  }
  // Loaded only here, so a fixture build never evaluates the chat seam.
  const { LiveChatRoute } = await import('@/app/(product)/_components/chat/live/live-chat-route')
  return <LiveChatRoute chatId={id?.[0]} searchParams={query} />
}
