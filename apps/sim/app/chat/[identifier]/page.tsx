import type { Metadata } from 'next'
import ChatClient from '@/app/chat/[identifier]/chat'
import { OfficeEmbedInit } from '@/app/chat/[identifier]/office-embed-init'

export const metadata: Metadata = {
  title: 'Chat',
}

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ identifier: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { identifier } = await params
  const { embed } = await searchParams
  const isOfficeEmbed = embed === 'office' || (Array.isArray(embed) && embed.includes('office'))

  return (
    <>
      {isOfficeEmbed && <OfficeEmbedInit />}
      <ChatClient key={identifier} identifier={identifier} />
    </>
  )
}
