import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/../../packages/db'
import { account } from '@/../../packages/db/schema'

const logger = createLogger('TrelloStore')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to store Trello token')
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json({ success: false, error: 'Token required' }, { status: 400 })
    }

    const apiKey = env.TRELLO_API_KEY
    if (!apiKey) {
      logger.error('TRELLO_API_KEY not configured')
      return NextResponse.json({ success: false, error: 'Trello not configured' }, { status: 500 })
    }

    const validationUrl = `https://api.trello.com/1/members/me?key=${apiKey}&token=${token}&fields=id,username,fullName,email`
    const userResponse = await fetch(validationUrl, {
      headers: { Accept: 'application/json' },
    })

    if (!userResponse.ok) {
      const errorText = await userResponse.text()
      logger.error('Invalid Trello token', {
        status: userResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        { success: false, error: `Invalid Trello token: ${errorText}` },
        { status: 400 }
      )
    }

    const trelloUser = await userResponse.json()

    const existing = await db.query.account.findFirst({
      where: and(eq(account.userId, session.user.id), eq(account.providerId, 'trello')),
    })

    const now = new Date()

    if (existing) {
      await db
        .update(account)
        .set({
          accessToken: token,
          accountId: trelloUser.id,
          scope: 'read,write',
          updatedAt: now,
        })
        .where(eq(account.id, existing.id))
    } else {
      await db.insert(account).values({
        id: `trello_${session.user.id}_${Date.now()}`,
        userId: session.user.id,
        providerId: 'trello',
        accountId: trelloUser.id,
        accessToken: token,
        scope: 'read,write',
        createdAt: now,
        updatedAt: now,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error storing Trello token:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
