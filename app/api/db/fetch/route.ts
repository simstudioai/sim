import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { workflow } from '@/db/schema'

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all workflows for the current user
    const userWorkflows = await db
      .select()
      .from(workflow)
      .where(eq(workflow.userId, session.user.id))

    return NextResponse.json({
      success: true,
      workflows: userWorkflows,
    })
  } catch (error) {
    console.error('Fetch workflows error:', error)
    return NextResponse.json({ error: 'Failed to fetch workflows' }, { status: 500 })
  }
}
