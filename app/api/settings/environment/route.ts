import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { hashSecret } from '@/lib/utils'
import { EnvironmentVariable } from '@/stores/settings/environment/types'
import { db } from '@/db'
import { userEnvironment } from '@/db/schema'

const EnvironmentSchema = z.object({
  userId: z.string(),
  data: z.string(), // A JSON stringified object of envvars
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { userId, data } = EnvironmentSchema.parse(body)

    // Parse the incoming JSON string
    const parsedData = JSON.parse(data) as Record<string, EnvironmentVariable>

    // Hash all environment variables with unique salts
    const securedData = await Promise.all(
      Object.entries(parsedData).map(async ([key, value]) => {
        const { hash, salt } = await hashSecret(value.value)
        return [key, { key, value: hash, salt }]
      })
    )

    // Store the hashed values
    await db
      .insert(userEnvironment)
      .values({
        id: nanoid(),
        userId,
        variables: Object.fromEntries(securedData),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userEnvironment.userId],
        set: {
          variables: Object.fromEntries(securedData),
          updatedAt: new Date(),
        },
      })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Environment update error:', error)
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

    const result = await db
      .select()
      .from(userEnvironment)
      .where(eq(userEnvironment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return NextResponse.json({ data: {} }, { status: 200 })
    }

    // Parse the variables and return just the structure without the hashed values
    const variables = result[0].variables as Record<string, any>
    const sanitizedVariables = Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [
        key,
        { key, value: '••••••••' }, // Hide the actual value
      ])
    )

    return NextResponse.json({ data: sanitizedVariables }, { status: 200 })
  } catch (error: any) {
    console.error('Environment fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
