import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { session, user } from '@/db/schema'

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    // Get session by token
    const sessionRecord = await db
      .select()
      .from(session)
      .where(eq(session.id, token))
      .limit(1)
      .then((rows) => rows[0])

    if (!sessionRecord) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    // Get user from session
    const userRecord = await db
      .select()
      .from(user)
      .where(eq(user.id, sessionRecord.userId))
      .limit(1)
      .then((rows) => rows[0])

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Return minimal user info (only what's needed)
    return NextResponse.json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
      },
    })
  } catch (error) {
    console.error('Session API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
