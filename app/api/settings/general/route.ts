import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { db } from '@/db'
import { settings } from '@/db/schema'

const SettingsSchema = z.object({
  userId: z.string(),
  isAutoConnectEnabled: z.boolean().default(true),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
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
  } catch (error: any) {
    console.error('Settings update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
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
    console.error('Settings fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
