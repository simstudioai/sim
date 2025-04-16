import ChatbotClient from './components/chatbot-client'

export default async function ChatbotPage({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params
  console.log('subdomain', subdomain)
  return <ChatbotClient subdomain={subdomain} />
} 