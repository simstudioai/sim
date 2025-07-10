import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { persona } from '@/db/schema'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const result = await db.select().from(persona).where(eq(persona.id, id))
  if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ persona: result[0] })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const body = await req.json()
  const { name, description, photo } = body
  await db
    .update(persona)
    .set({
      name,
      description,
      photo,
      updatedAt: new Date(),
    })
    .where(eq(persona.id, id))
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  await db.delete(persona).where(eq(persona.id, id))
  return NextResponse.json({ success: true })
}
