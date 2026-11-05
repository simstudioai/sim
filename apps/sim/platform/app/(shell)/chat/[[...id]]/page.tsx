import { notFound } from 'next/navigation'
import { FixtureChat } from '@/platform/app/(shell)/_components/chat/conversation/fixture-chat'
import { ChatPanels } from '@/platform/app/(shell)/_components/chat/panel/chat-panels'
import { readScenario } from '@/platform/design-system/navigation'
import { loadConversationData, loadPanelData, loadShellData } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

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
  const scenario = readScenario(query.state)
  const [data, panel, shell] = await Promise.all([
    loadConversationData(scenario),
    loadPanelData(scenario),
    loadShellData(scenario),
  ])
  return (
    <ChatPanels workspaces={shell?.workspaces ?? []} data={panel} key={id?.[0] ?? 'new'}>
      <FixtureChat data={data?.chat ?? null} chatId={id?.[0]} />
    </ChatPanels>
  )
}
