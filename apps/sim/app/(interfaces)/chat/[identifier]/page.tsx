import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { Metadata } from 'next'
import ChatClient from '@/app/(interfaces)/chat/[identifier]/chat'
import { OfficeEmbedInit } from '@/app/(interfaces)/chat/[identifier]/office-embed-init'

const logger = createLogger('ChatMetadata')

/**
 * Only fully public, active deployments are indexable. Auth-gated (password,
 * email, SSO) and inactive/nonexistent chats are noindexed at the page level
 * so Google never indexes an auth wall — narrower than blocking `/chat/`
 * entirely in robots.ts, which would also hide genuinely public deployments.
 *
 * Errors from the lookup fail toward noindex rather than throwing: unlike
 * the identical query in app/api/chat/[identifier]/route.ts (which must
 * surface failures to the caller), a metadata resolution error has no
 * error.tsx boundary in this route to catch it — throwing here would take
 * the whole page down instead of just skipping indexability, and "can't
 * confirm this is safe to index" should default to not indexing it anyway.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ identifier: string }>
}): Promise<Metadata> {
  const { identifier } = await params

  let isIndexable = false
  try {
    const [deployment] = await db
      .select({ authType: chat.authType, isActive: chat.isActive })
      .from(chat)
      .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
      .limit(1)

    isIndexable = Boolean(deployment?.isActive && deployment.authType === 'public')
  } catch (error) {
    logger.error('Failed to resolve chat deployment for metadata', {
      identifier,
      error: getErrorMessage(error),
    })
  }

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
