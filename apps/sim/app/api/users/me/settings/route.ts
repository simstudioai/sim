import { db } from '@sim/db'
import { settings } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('UserSettingsAPI')

const SettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  autoConnect: z.boolean().optional(),
  autoFillEnvVars: z.boolean().optional(), // DEPRECATED: kept for backwards compatibility
  autoPan: z.boolean().optional(),
  consoleExpandedByDefault: z.boolean().optional(),
  telemetryEnabled: z.boolean().optional(),
  emailPreferences: z
    .object({
      unsubscribeAll: z.boolean().optional(),
      unsubscribeMarketing: z.boolean().optional(),
      unsubscribeUpdates: z.boolean().optional(),
      unsubscribeNotifications: z.boolean().optional(),
    })
    .optional(),
  billingUsageNotificationsEnabled: z.boolean().optional(),
  showFloatingControls: z.boolean().optional(),
  showTrainingControls: z.boolean().optional(),
  superUserModeEnabled: z.boolean().optional(),
})

// Default settings values
const defaultSettings = {
  theme: 'system',
  autoConnect: true,
  autoFillEnvVars: true, // DEPRECATED: kept for backwards compatibility, always true
  autoPan: true,
  consoleExpandedByDefault: true,
  telemetryEnabled: true,
  emailPreferences: {},
  billingUsageNotificationsEnabled: true,
  showFloatingControls: true,
  showTrainingControls: false,
  superUserModeEnabled: false,
}

export async function GET() {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    // Return default settings for unauthenticated users instead of 401 error
    if (!session?.user?.id) {
      logger.info(`[${requestId}] Returning default settings for unauthenticated user`)
      return NextResponse.json({ data: defaultSettings }, { status: 200 })
    }

    const userId = session.user.id
    const result = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (!result.length) {
      return NextResponse.json({ data: defaultSettings }, { status: 200 })
    }

    const userSettings = result[0]

    return NextResponse.json(
      {
        data: {
          theme: userSettings.theme,
          autoConnect: userSettings.autoConnect,
          autoFillEnvVars: userSettings.autoFillEnvVars, // DEPRECATED: kept for backwards compatibility
          autoPan: userSettings.autoPan,
          consoleExpandedByDefault: userSettings.consoleExpandedByDefault,
          telemetryEnabled: userSettings.telemetryEnabled,
          emailPreferences: userSettings.emailPreferences ?? {},
          billingUsageNotificationsEnabled: userSettings.billingUsageNotificationsEnabled ?? true,
          showFloatingControls: userSettings.showFloatingControls ?? true,
          showTrainingControls: userSettings.showTrainingControls ?? false,
          superUserModeEnabled: userSettings.superUserModeEnabled ?? true,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Settings fetch error`, error)
    // Return default settings on error instead of error response
    return NextResponse.json({ data: defaultSettings }, { status: 200 })
  }
}

export async function PATCH(request: Request) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    // Return success for unauthenticated users instead of error
    if (!session?.user?.id) {
      logger.info(
        `[${requestId}] Settings update attempted by unauthenticated user - acknowledged without saving`
      )
      return NextResponse.json({ success: true }, { status: 200 })
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
    // Return success on error instead of error response
    return NextResponse.json({ success: true }, { status: 200 })
  }
}
