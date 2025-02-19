import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/utils'
import { EnvironmentVariable } from '@/stores/settings/environment/types'
import { db } from '@/db'
import { environment } from '@/db/schema'

// Schema for environment variable updates
const EnvVarSchema = z.object({
  variables: z.record(z.string()),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { variables } = EnvVarSchema.parse(body)

    // Encrypt each environment variable value
    const encryptedVariables: Record<string, string> = {}
    for (const [key, value] of Object.entries(variables)) {
      const { encrypted } = await encryptSecret(value)
      encryptedVariables[key] = encrypted
    }

    // Upsert the environment variables
    await db
      .insert(environment)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.id,
        variables: encryptedVariables,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [environment.userId],
        set: {
          variables: encryptedVariables,
          updatedAt: new Date(),
        },
      })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating environment variables:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update environment variables' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const result = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return NextResponse.json({ data: {} }, { status: 200 })
    }

    // Update the type handling for variables
    const variables = result[0].variables as Record<string, EnvironmentVariable>
    const sanitizedVariables = Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [key, { key, value: '••••••••' }])
    )

    return NextResponse.json({ data: sanitizedVariables }, { status: 200 })
  } catch (error: any) {
    console.error('Environment fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
