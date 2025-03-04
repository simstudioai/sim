import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { decryptSecret, encryptSecret } from '@/lib/utils'
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

    // Encrypt all variables
    const encryptedVariables = await Object.entries(variables).reduce(
      async (accPromise, [key, value]) => {
        const acc = await accPromise
        const { encrypted } = await encryptSecret(value)
        return { ...acc, [key]: encrypted }
      },
      Promise.resolve({})
    )

    // Replace all environment variables for user
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
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const result = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return NextResponse.json({ data: {} }, { status: 200 })
    }

    // Decrypt the variables for client-side use
    const encryptedVariables = result[0].variables as Record<string, string>
    const decryptedVariables: Record<string, EnvironmentVariable> = {}

    // Decrypt each variable
    for (const [key, encryptedValue] of Object.entries(encryptedVariables)) {
      try {
        const { decrypted } = await decryptSecret(encryptedValue)
        decryptedVariables[key] = { key, value: decrypted }
      } catch (error) {
        console.error(`Error decrypting variable ${key}:`, error)
        // If decryption fails, provide a placeholder
        decryptedVariables[key] = { key, value: '' }
      }
    }

    return NextResponse.json({ data: decryptedVariables }, { status: 200 })
  } catch (error: any) {
    console.error('Environment fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
