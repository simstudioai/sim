import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { personaConnection } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// Connect persona to another persona
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { personaId, connectedPersonaId } = body
  if (!personaId || !connectedPersonaId) {
    return NextResponse.json({ error: 'personaId and connectedPersonaId are required' }, { status: 400 })
  }
  const newConnection = {
    id: nanoid(),
    personaId,
    connectedPersonaId,
  }
  await db.insert(personaConnection).values(newConnection)
  return NextResponse.json({ connection: newConnection })
}

// Disconnect persona from another persona
export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const { personaId, connectedPersonaId } = body
  if (!personaId || !connectedPersonaId) {
    return NextResponse.json({ error: 'personaId and connectedPersonaId are required' }, { status: 400 })
  }
  await db.delete(personaConnection).where(and(
    eq(personaConnection.personaId, personaId),
    eq(personaConnection.connectedPersonaId, connectedPersonaId)
  ))
  return NextResponse.json({ success: true })
}

// List connections for a persona
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const personaId = searchParams.get('personaId')
  if (!personaId) return NextResponse.json({ error: 'personaId required' }, { status: 400 })
  const connections = await db.select().from(personaConnection).where(eq(personaConnection.personaId, personaId))
  return NextResponse.json({ connections })
} 