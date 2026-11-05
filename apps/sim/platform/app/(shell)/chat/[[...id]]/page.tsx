import { notFound } from 'next/navigation'
import { Conversation } from '@/platform/app/(shell)/chat/_components/conversation/conversation'
import { ChatPanels } from '@/platform/app/(shell)/chat/_components/panel/chat-panels'
import { readScenario } from '@/platform/design-system/navigation'
import { loadConversationData, loadPanelData, loadShellData } from '@/platform/fixtures'

export default async function Page({ searchParams, params }: PageProps<'/chat/[[...id]]'>) {
  const [query, { id }] = await Promise.all([searchParams, params])
  if (id && id.length !== 1) notFound()
  const scenario = readScenario(query.state)
  const [data, panel, shell] = await Promise.all([
    loadConversationData(scenario),
    loadPanelData(scenario),
    loadShellData(scenario),
  ])
  return (
    <ChatPanels workspaces={shell?.workspaces ?? []} data={panel} key={id?.[0] ?? 'new'}>
      <Conversation data={data?.chat ?? null} chatId={id?.[0]} />
    </ChatPanels>
  )
}
