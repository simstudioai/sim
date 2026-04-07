import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { validateAuthToken } from '@/lib/core/security/deployment'

const logger = createLogger('SpeechTokenAPI')

export const dynamic = 'force-dynamic'

const ELEVENLABS_TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'

async function validateChatAuth(request: NextRequest, chatId: string): Promise<boolean> {
  try {
    const chatResult = await db
      .select({
        id: chat.id,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
      })
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1)

    if (chatResult.length === 0 || !chatResult[0].isActive) return false

    const chatData = chatResult[0]
    if (chatData.authType === 'public') return true

    const cookieName = `chat_auth_${chatId}`
    const authCookie = request.cookies.get(cookieName)
    if (authCookie && validateAuthToken(authCookie.value, chatId, chatData.password)) {
      return true
    }

    return false
  } catch (error) {
    logger.error('Error validating chat auth for STT:', error)
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const chatId = body?.chatId as string | undefined

    if (chatId) {
      const isChatAuthed = await validateChatAuth(request, chatId)
      if (!isChatAuthed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey?.trim()) {
      return NextResponse.json(
        { error: 'Speech-to-text service is not configured' },
        { status: 503 }
      )
    }

    const response = await fetch(ELEVENLABS_TOKEN_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
    })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const message =
        errBody.detail || errBody.message || `Token request failed (${response.status})`
      logger.error('ElevenLabs token request failed', { status: response.status, message })
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const data = await response.json()
    return NextResponse.json({ token: data.token })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate speech token'
    logger.error('Speech token error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
