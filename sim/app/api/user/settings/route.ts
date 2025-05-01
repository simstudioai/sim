import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { settings } from '@/db/schema'
import { getSession } from '@/lib/auth'

const logger = createLogger('UserSettingsAPI')

const SettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  debugMode: z.boolean().optional(),
  autoConnect: z.boolean().optional(),
  autoFillEnvVars: z.boolean().optional(),
  telemetryEnabled: z.boolean().optional(),
  telemetryNotifiedUser: z.boolean().optional(),
})

export async function GET() {
  const requestId = crypto.randomUUID().slice(0, 8)
  
  try {
    const session = await getSession()
    
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized settings access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const userId = session.user.id
    const result = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (!result.length) {
      return NextResponse.json(
        {
          data: {
            // Return default values
            theme: 'system',
            debugMode: false,
            autoConnect: true,
            autoFillEnvVars: true,
            telemetryEnabled: true,
            telemetryNotifiedUser: false,
          },
        },
        { status: 200 }
      )
    }

    const userSettings = result[0]
    
    return NextResponse.json(
      {
        data: {
          theme: userSettings.theme,
          debugMode: userSettings.debugMode,
          autoConnect: userSettings.autoConnect,
          autoFillEnvVars: userSettings.autoFillEnvVars,
          telemetryEnabled: userSettings.telemetryEnabled,
          telemetryNotifiedUser: userSettings.telemetryNotifiedUser,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Settings fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized settings update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const userId = session.user.id
    const body = await request.json()

    try {
      const validatedData = SettingsSchema.parse(body)

      // Store the settings
      await db
        .insert(settings)
        .values({
          id: nanoid(),
          userId,
          ...validatedData,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [settings.userId],
          set: {
            ...validatedData,
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