import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { persona } from '@/db/schema'

// List all personas (optionally by workspace)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId')
  let personas
  if (workspaceId) {
    personas = await db.select().from(persona).where(eq(persona.workspaceId, workspaceId))
  } else {
    personas = await db.select().from(persona)
  }
  return NextResponse.json({ personas })
}

// Create new persona
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { workspaceId, name, description, photo } = body
  if (!workspaceId || !name) {
    return NextResponse.json({ error: 'workspaceId and name are required' }, { status: 400 })
  }
  const newPersona = {
    id: nanoid(),
    workspaceId,
    name,
    description: description || '',
    photo: photo || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.insert(persona).values(newPersona)
  return NextResponse.json({ persona: newPersona })
}
