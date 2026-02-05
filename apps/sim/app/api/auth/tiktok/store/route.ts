import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getTikTokRefreshTokenExpiry } from '@/lib/oauth/utils'
import { safeAccountInsert } from '@/app/api/auth/oauth/utils'
import { db } from '@/../../packages/db'
import { account } from '@/../../packages/db/schema'

const logger = createLogger('TikTokStore')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to store TikTok token')
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { accessToken, refreshToken, expiresIn, openId, scope } = body

    if (!accessToken || !openId) {
      return NextResponse.json(
        { success: false, error: 'Access token and open_id required' },
        { status: 400 }
      )
    }

    // Fetch user info from TikTok to get display name
    let displayName = 'TikTok User'
    let avatarUrl: string | undefined

    try {
      const userResponse = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (userResponse.ok) {
        const userData = await userResponse.json()
        if (userData.data?.user) {
          displayName = userData.data.user.display_name || displayName
          avatarUrl = userData.data.user.avatar_url
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch TikTok user info:', error)
    }

    const existing = await db.query.account.findFirst({
      where: and(eq(account.userId, session.user.id), eq(account.providerId, 'tiktok')),
    })

    const now = new Date()
    const accessTokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined
    const refreshTokenExpiresAt = getTikTokRefreshTokenExpiry()

    if (existing) {
      await db
        .update(account)
        .set({
          accessToken,
          refreshToken,
          accountId: openId,
          scope:
            scope || 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish',
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          updatedAt: now,
        })
        .where(eq(account.id, existing.id))

      logger.info('Updated existing TikTok account', { accountId: openId })
    } else {
      await safeAccountInsert(
        {
          id: `tiktok_${session.user.id}_${Date.now()}`,
          userId: session.user.id,
          providerId: 'tiktok',
          accountId: openId,
          accessToken,
          refreshToken,
          scope:
            scope || 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish',
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          createdAt: now,
          updatedAt: now,
        },
        { provider: 'TikTok', identifier: openId }
      )

      logger.info('Created new TikTok account', { accountId: openId })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error storing TikTok token:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
