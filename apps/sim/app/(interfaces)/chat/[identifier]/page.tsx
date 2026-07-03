import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { Metadata } from 'next'
import ChatClient from '@/app/(interfaces)/chat/[identifier]/chat'
import { OfficeEmbedInit } from '@/app/(interfaces)/chat/[identifier]/office-embed-init'

/**
 * Only fully public, active deployments are indexable. Auth-gated (password,
 * email, SSO) and inactive/nonexistent chats are noindexed at the page level
 * so Google never indexes an auth wall — narrower than blocking `/chat/`
 * entirely in robots.ts, which would also hide genuinely public deployments.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ identifier: string }>
}): Promise<Metadata> {
  const { identifier } = await params

  const [deployment] = await db
    .select({ authType: chat.authType, isActive: chat.isActive })
    .from(chat)
    .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
    .limit(1)

  const isIndexable = Boolean(deployment?.isActive && deployment.authType === 'public')

  return {
    title: 'Chat',
    ...(!isIndexable && { robots: { index: false, follow: false } }),
  }
}

export const dynamic = 'force-dynamic'

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
