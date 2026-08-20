import ChatClient from './chat-client'

export default async function ChatPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params
  return <ChatClient subdomain={subdomain} />
}
