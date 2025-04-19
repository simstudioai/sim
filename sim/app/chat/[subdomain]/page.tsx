import { createLogger } from '@/lib/logs/console-logger'
import ChatClient from './components/chat-client'

const logger = createLogger('ChatPage')

export default async function ChatPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params
  logger.info(`[ChatPage] subdomain: ${subdomain}`)
  return <ChatClient subdomain={subdomain} />
}
