import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/../../packages/db'
import { settings } from '@/../../packages/db/schema'

const logger = createLogger('CopilotUserModelsAPI')

const DEFAULT_ENABLED_MODELS: Record<string, boolean> = {
  'gpt-4o': false,
  'gpt-4.1': false,
  'gpt-5-fast': false,
  'gpt-5': true,
  'gpt-5-medium': true,
  'gpt-5-high': false,
  o3: true,
  'claude-4-sonnet': false,
  'claude-4.5-haiku': true,
  'claude-4.5-sonnet': true,
  'claude-4.1-opus': true,
}

// GET - Fetch user's enabled models
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Try to fetch existing settings record
    const [userSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    if (userSettings) {
      const userModelsMap = (userSettings.copilotEnabledModels as Record<string, boolean>) || {}

      // Merge: start with defaults, then override with user's existing preferences
      const mergedModels = { ...DEFAULT_ENABLED_MODELS }
      for (const [modelId, enabled] of Object.entries(userModelsMap)) {
        mergedModels[modelId] = enabled
      }

      // If we added any new models, update the database
      const hasNewModels = Object.keys(DEFAULT_ENABLED_MODELS).some(
        (key) => !(key in userModelsMap)
      )

      if (hasNewModels) {
        await db
          .update(settings)
          .set({
            copilotEnabledModels: mergedModels,
            updatedAt: new Date(),
          })
          .where(eq(settings.userId, userId))
      }

      return NextResponse.json({
        enabledModels: mergedModels,
      })
    }

    // If no settings record exists, create one with defaults
    await db.insert(settings).values({
      id: userId,
      userId,
      copilotEnabledModels: DEFAULT_ENABLED_MODELS,
    })

    logger.info('Created new settings record with default models', { userId })

    return NextResponse.json({
      enabledModels: DEFAULT_ENABLED_MODELS,
    })
  } catch (error) {
    logger.error('Failed to fetch user models', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Update user's enabled models
export async function PUT(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    if (!body.enabledModels || typeof body.enabledModels !== 'object') {
      return NextResponse.json({ error: 'enabledModels must be an object' }, { status: 400 })
    }

    // Check if settings record exists
    const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (existing) {
      // Update existing record
      await db
        .update(settings)
        .set({
          copilotEnabledModels: body.enabledModels,
          updatedAt: new Date(),
        })
        .where(eq(settings.userId, userId))
    } else {
      // Create new settings record
      await db.insert(settings).values({
        id: userId,
        userId,
        copilotEnabledModels: body.enabledModels,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to update user models', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
