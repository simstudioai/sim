import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { Metadata } from 'next'
import ChatClient from '@/app/(interfaces)/chat/[identifier]/chat'
import { OfficeEmbedInit } from '@/app/(interfaces)/chat/[identifier]/office-embed-init'

const logger = createLogger('ChatMetadata')

const NOINDEX: Metadata['robots'] = { index: false, follow: false }

/**
 * Deployed chats are never indexed: they are thin, client-rendered pages built
 * by users, not Sim content. A public, active chat gets its own title and
 * description for link previews; auth-gated, inactive, and unknown chats get a
 * generic title so nothing behind the gate leaks.
 *
 * A lookup error falls back to the generic title rather than throwing: this
 * route has no error.tsx boundary, so a throw would take the whole page down.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ identifier: string }>
}): Promise<Metadata> {
  const { identifier } = await params

  try {
    const [deployment] = await db
      .select({
        title: chat.title,
        description: chat.description,
        authType: chat.authType,
        isActive: chat.isActive,
      })
      .from(chat)
      .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
      .limit(1)

    if (deployment?.isActive && deployment.authType === 'public') {
      const { title } = deployment
      const description = deployment.description || undefined
      return {
        title,
        description,
        openGraph: { title, description, type: 'website' },
        twitter: { card: 'summary', title, description },
        robots: NOINDEX,
      }
    }
  } catch (error) {
    logger.error('Failed to resolve chat deployment for metadata', {
      identifier,
      error: getErrorMessage(error),
    })
  }

  return { title: 'Chat', robots: NOINDEX }
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
