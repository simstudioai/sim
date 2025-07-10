import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { personaWorkflow } from '@/db/schema'

// Assign workflow to persona
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { personaId, workflowId, status } = body
  if (!personaId || !workflowId) {
    return NextResponse.json({ error: 'personaId and workflowId are required' }, { status: 400 })
  }
  const newPersonaWorkflow = {
    id: nanoid(),
    personaId,
    workflowId,
    status: status || 'in progress',
  }
  await db.insert(personaWorkflow).values(newPersonaWorkflow)
  return NextResponse.json({ personaWorkflow: newPersonaWorkflow })
}

// Update workflow status for persona
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { personaWorkflowId, status } = body
  if (!personaWorkflowId || !status) {
    return NextResponse.json(
      { error: 'personaWorkflowId and status are required' },
      { status: 400 }
    )
  }
  await db.update(personaWorkflow).set({ status }).where(eq(personaWorkflow.id, personaWorkflowId))
  return NextResponse.json({ success: true })
}

// List workflows for a persona
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const personaId = searchParams.get('personaId')
  if (!personaId) return NextResponse.json({ error: 'personaId required' }, { status: 400 })
  const workflows = await db
    .select()
    .from(personaWorkflow)
    .where(eq(personaWorkflow.personaId, personaId))
  return NextResponse.json({ workflows })
}
