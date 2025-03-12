import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { settings } from '@/db/schema'

const logger = createLogger('SettingsAPI')

const SettingsSchema = z.object({
  userId: z.string(),
  isAutoConnectEnabled: z.boolean().default(true),
})

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()

    try {
      const { userId, isAutoConnectEnabled } = SettingsSchema.parse(body)

      // Store the settings
      await db
        .insert(settings)
        .values({
          id: nanoid(),
          userId,
          general: { isAutoConnectEnabled },
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [settings.userId],
          set: {
            general: { isAutoConnectEnabled },
            updatedAt: new Date(),
          },
        })

      return NextResponse.json({ success: true }, { status: 200 })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid settings data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid settings data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Settings update error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      logger.warn(`[${requestId}] Missing userId parameter`)
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const result = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (!result.length) {
      return NextResponse.json(
        {
          data: {
            isAutoConnectEnabled: true, // Return default values
          },
        },
        { status: 200 }
      )
    }

    const generalSettings = result[0].general as { isAutoConnectEnabled: boolean }
    return NextResponse.json(
      {
        data: {
          isAutoConnectEnabled: generalSettings.isAutoConnectEnabled,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Settings fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
