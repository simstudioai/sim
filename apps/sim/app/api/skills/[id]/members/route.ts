import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { skillMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { removeSkillMemberContract, upsertSkillMemberContract } from '@/lib/api/contracts/skills'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getSkillActorContext, listSkillEditors } from '@/lib/skills/access'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SkillMembersAPI')

interface RouteContext {
  params: Promise<{ id: string }>
}

type SkillEditorGate =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'not-found' | 'not-editor' }

/**
 * Resolves the skill and asserts the actor can edit it (explicit editor row or
 * derived workspace admin). Skills the actor cannot reach at all (missing,
 * builtin, no workspace, no workspace access) read as not-found;
 * visible-but-not-editor reads as forbidden.
 */
async function requireSkillEditor(skillId: string, userId: string): Promise<SkillEditorGate> {
  if (isBuiltinSkillId(skillId)) return { ok: false, reason: 'not-found' }

  const actor = await getSkillActorContext(skillId, userId)
  if (!actor.skill?.workspaceId || !actor.hasWorkspaceAccess) {
    return { ok: false, reason: 'not-found' }
  }
  if (!actor.canEdit) return { ok: false, reason: 'not-editor' }

  return { ok: true, workspaceId: actor.skill.workspaceId }
}

function skillEditorGateResponse(reason: 'not-found' | 'not-editor'): NextResponse {
  return reason === 'not-found'
    ? NextResponse.json({ error: 'Not found' }, { status: 404 })
    : NextResponse.json({ error: 'Skill editor access required' }, { status: 403 })
}

export const GET = withRouteHandler(async (_request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skillId } = await context.params

    if (isBuiltinSkillId(skillId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const actor = await getSkillActorContext(skillId, session.user.id)
    if (!actor.skill?.workspaceId || !actor.hasWorkspaceAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const editors = await listSkillEditors({
      id: actor.skill.id,
      workspaceId: actor.skill.workspaceId,
    })

    return NextResponse.json({ editors })
  } catch (error) {
    logger.error('Failed to fetch skill editors', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skillId } = await context.params

    const gate = await requireSkillEditor(skillId, session.user.id)
    if (!gate.ok) {
      logger.warn('Skill editor add denied', {
        skillId,
        actorId: session.user.id,
        reason: gate.reason,
      })
      return skillEditorGateResponse(gate.reason)
    }

    const parsed = await parseRequest(upsertSkillMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { userId } = parsed.data.body

    const targetWorkspacePerm = await getUserEntityPermissions(
      userId,
      'workspace',
      gate.workspaceId
    )
    if (targetWorkspacePerm === null) {
      return NextResponse.json({ error: 'User is not a member of this workspace' }, { status: 400 })
    }
    if (targetWorkspacePerm === 'admin') {
      return NextResponse.json(
        { error: 'Workspace admins can always edit skills' },
        { status: 400 }
      )
    }

    const [existing] = await db
      .select({ id: skillMember.id })
      .from(skillMember)
      .where(and(eq(skillMember.skillId, skillId), eq(skillMember.userId, userId)))
      .limit(1)

    if (existing) {
      return NextResponse.json({ success: true })
    }

    const now = new Date()
    // Conflict-safe against a concurrent add racing the unique (skillId, userId) index.
    const [inserted] = await db
      .insert(skillMember)
      .values({
        id: generateId(),
        skillId,
        userId,
        invitedBy: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [skillMember.skillId, skillMember.userId] })
      .returning({ id: skillMember.id })

    // A concurrent request won the race and created the row. The editor exists,
    // so this is still a success — but this request added nothing, and emitting
    // the share event or audit entry here would record an add that never happened.
    if (!inserted) {
      return NextResponse.json({ success: true })
    }

    captureServerEvent(
      session.user.id,
      'skill_shared',
      { skill_id: skillId, workspace_id: gate.workspaceId },
      { groups: { workspace: gate.workspaceId } }
    )

    recordAudit({
      workspaceId: gate.workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.SKILL_MEMBER_ADDED,
      resourceType: AuditResourceType.SKILL,
      resourceId: skillId,
      description: 'Added skill editor',
      metadata: { targetUserId: userId },
      request,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    logger.error('Failed to add skill editor', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: skillId } = await context.params

    const gate = await requireSkillEditor(skillId, session.user.id)
    if (!gate.ok) {
      logger.warn('Skill editor removal denied', {
        skillId,
        actorId: session.user.id,
        reason: gate.reason,
      })
      return skillEditorGateResponse(gate.reason)
    }

    const parsed = await parseRequest(removeSkillMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { userId: targetUserId } = parsed.data.query

    const targetWorkspacePerm = await getUserEntityPermissions(
      targetUserId,
      'workspace',
      gate.workspaceId
    )
    if (targetWorkspacePerm === 'admin') {
      return NextResponse.json(
        { error: 'Workspace admins can always edit skills' },
        { status: 400 }
      )
    }

    // Hard delete — no deny markers and no last-editor guard: workspace admins
    // always remain derived editors, so a skill can never be orphaned.
    const removed = await db
      .delete(skillMember)
      .where(and(eq(skillMember.skillId, skillId), eq(skillMember.userId, targetUserId)))
      .returning({ id: skillMember.id })

    if (removed.length === 0) {
      return NextResponse.json({ error: 'Editor not found' }, { status: 404 })
    }

    captureServerEvent(
      session.user.id,
      'skill_unshared',
      { skill_id: skillId, workspace_id: gate.workspaceId },
      { groups: { workspace: gate.workspaceId } }
    )

    recordAudit({
      workspaceId: gate.workspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.SKILL_MEMBER_REMOVED,
      resourceType: AuditResourceType.SKILL,
      resourceId: skillId,
      description: 'Removed skill editor',
      metadata: { targetUserId },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to remove skill editor', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
