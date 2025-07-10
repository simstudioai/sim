import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { agentWorkflow } from '@/db/schema'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  await db.delete(agentWorkflow).where(eq(agentWorkflow.id, id))
  return NextResponse.json({ success: true })
}
