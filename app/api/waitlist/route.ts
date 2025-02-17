import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { db } from '@/db'
import { waitlist } from '@/db/schema'

const waitlistSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email } = waitlistSchema.parse(body)

    // Check if email already exists
    const existingEntry = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.email, email))
      .execute()

    if (existingEntry.length > 0) {
      return NextResponse.json({ message: 'Email already registered' }, { status: 400 })
    }

    // Add to waitlist
    await db.insert(waitlist).values({
      id: nanoid(),
      email,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return NextResponse.json({ message: 'Successfully joined waitlist' }, { status: 200 })
  } catch (error) {
    console.error('Waitlist error:', error)
    return NextResponse.json({ message: 'Failed to join waitlist' }, { status: 500 })
  }
}
