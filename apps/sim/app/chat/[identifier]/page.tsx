import ChatClient from '@/app/chat/[identifier]/chat'

export default async function ChatPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params
  return <ChatClient identifier={identifier} />
}
