import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { userStats, workflow } from '@/db/schema'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const searchParams = request.nextUrl.searchParams
  const runs = parseInt(searchParams.get('runs') || '1', 10)

  if (isNaN(runs) || runs < 1 || runs > 100) {
    return NextResponse.json(
      { error: 'Invalid number of runs. Must be between 1 and 100.' },
      { status: 400 }
    )
  }

  try {
    const [workflowRecord] = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1)

    if (!workflowRecord) {
      return NextResponse.json({ error: `Workflow ${id} not found` }, { status: 404 })
    }

    await db
      .update(workflow)
      .set({
        runCount: workflowRecord.runCount + runs,
        lastRunAt: new Date(),
      })
      .where(eq(workflow.id, id))

    await db
      .update(userStats)
      .set({
        totalWorkflowRuns: sql`total_workflow_runs + ${runs}`,
        lastActive: new Date(),
      })
      .where(eq(userStats.userId, workflowRecord.userId))

    return NextResponse.json({
      success: true,
      runsAdded: runs,
      newTotal: workflowRecord.runCount + runs,
    })
  } catch (error) {
    console.error('Error updating workflow stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
