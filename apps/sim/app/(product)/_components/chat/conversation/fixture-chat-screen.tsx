import { ChatScreen } from '@/app/(product)/_components/chat/conversation/chat-screen'
import { FixtureChat } from '@/app/(product)/_components/chat/conversation/fixture-chat'
import { ChatPanels } from '@/app/(product)/_components/chat/panel/chat-panels'
import {
  loadConversationData,
  loadPanelData,
  loadShellData,
  type Scenario,
} from '@/platform/fixtures'

interface FixtureChatScreenProps {
  scenario: Scenario
  chatId?: string
}

export async function FixtureChatScreen({ scenario, chatId }: FixtureChatScreenProps) {
  const [data, panel, shell] = await Promise.all([
    loadConversationData(scenario),
    loadPanelData(scenario),
    loadShellData(scenario),
  ])
  return (
    <ChatScreen>
      <ChatPanels workspaces={shell.workspaces} data={panel} key={chatId ?? 'new'}>
        <FixtureChat data={data.chat} chatId={chatId} />
      </ChatPanels>
    </ChatScreen>
  )
}
