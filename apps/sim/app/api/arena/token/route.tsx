import { db } from '@sim/db'
import { userArenaDetails } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET() {
  try {
    // 1. Get session
    const session = await getSession()

    if (!session || !session.user?.id) {
      return NextResponse.json(
        { found: false, reason: 'Unauthorized - No session or userId' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // 2. Fetch Arena token for this user
    const details = await db
      .select({
        arenaToken: userArenaDetails.arenaToken,
      })
      .from(userArenaDetails)
      .where(eq(userArenaDetails.userIdRef, userId))
      .limit(1)

    if (details.length === 0 || !details[0].arenaToken) {
      return NextResponse.json(
        { found: false, reason: 'Arena token not found for user' },
        { status: 404 }
      )
    }

    // 3. Return token
    return NextResponse.json({
      found: true,
      userId,
      arenaToken: details[0].arenaToken,
    })
  } catch (err) {
    console.error('Error fetching Arena token:', err)
    return NextResponse.json({ found: false, reason: 'Internal server error' }, { status: 500 })
  }
}
