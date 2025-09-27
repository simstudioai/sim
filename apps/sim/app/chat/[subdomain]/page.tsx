import ChatClient from '@/app/chat/[subdomain]/chat'

export default async function ChatPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params
  return <ChatClient subdomain={subdomain} />
}
