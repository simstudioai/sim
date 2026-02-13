import { db } from '@sim/db'
import { pendingCredentialDraft } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, lt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'

const logger = createLogger('CredentialDraftAPI')

const DRAFT_TTL_MS = 15 * 60 * 1000

const createDraftSchema = z.object({
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().trim().max(500).optional(),
  credentialId: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = createDraftSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { workspaceId, providerId, displayName, description, credentialId } = parsed.data
    const userId = session.user.id
    const now = new Date()

    await db
      .delete(pendingCredentialDraft)
      .where(
        and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
      )

    await db
      .insert(pendingCredentialDraft)
      .values({
        id: crypto.randomUUID(),
        userId,
        workspaceId,
        providerId,
        displayName,
        description: description || null,
        credentialId: credentialId || null,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          pendingCredentialDraft.userId,
          pendingCredentialDraft.providerId,
          pendingCredentialDraft.workspaceId,
        ],
        set: {
          displayName,
          description: description || null,
          credentialId: credentialId || null,
          expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
          createdAt: now,
        },
      })

    logger.info('Credential draft saved', {
      userId,
      workspaceId,
      providerId,
      displayName,
      credentialId: credentialId || null,
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to save credential draft', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
