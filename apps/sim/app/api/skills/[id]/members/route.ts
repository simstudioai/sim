import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { skillMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { removeSkillMemberContract, upsertSkillMemberContract } from '@/lib/api/contracts/skills'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { DbOrTx } from '@/lib/db/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { getSkillActorContext, listSkillMembers } from '@/lib/skills/access'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SkillMembersAPI')

interface RouteContext {
  params: Promise<{ id: string }>
}

type SkillAdminGate =
  | { ok: true; workspaceId: string; workspaceShared: boolean }
  | { ok: false; reason: 'not-found' | 'not-admin' }

/**
 * Resolves the skill and asserts the actor's effective role is admin (explicit
 * member admin or derived workspace admin). Follows the feature-wide masking
 * policy: skills the actor cannot see at all (missing, builtin, no workspace,
 * role null) read as not-found; visible-but-not-admin reads as forbidden.
 */
async function requireSkillAdmin(skillId: string, userId: string): Promise<SkillAdminGate> {
  if (isBuiltinSkillId(skillId)) return { ok: false, reason: 'not-found' }

  const actor = await getSkillActorContext(skillId, userId)
  if (!actor.skill?.workspaceId || actor.role === null) return { ok: false, reason: 'not-found' }
  if (actor.role !== 'admin') return { ok: false, reason: 'not-admin' }

  return {
    ok: true,
    workspaceId: actor.skill.workspaceId,
    workspaceShared: actor.skill.workspaceShared,
  }
}

function skillAdminGateResponse(reason: 'not-found' | 'not-admin'): NextResponse {
  return reason === 'not-found'
    ? NextResponse.json({ error: 'Not found' }, { status: 404 })
    : NextResponse.json({ error: 'Skill admin access required' }, { status: 403 })
}

/**
 * Counts the skill's active explicit admins with the rows locked, so a
 * restricted skill's last explicit admin cannot be demoted or removed (they
 * would lose all access — the deny/removal is otherwise only reversible by a
 * workspace admin). Workspace-shared skills skip this: derived workspace
 * admins always remain, and losing an explicit row there is recoverable.
 */
async function wouldOrphanRestrictedSkill(tx: DbOrTx, skillId: string): Promise<boolean> {
  const activeAdmins = await tx
    .select({ id: skillMember.id })
    .from(skillMember)
    .where(
      and(
        eq(skillMember.skillId, skillId),
        eq(skillMember.role, 'admin'),
        eq(skillMember.status, 'active')
      )
    )
    .for('update')
  return activeAdmins.length <= 1
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
    if (!actor.skill?.workspaceId || actor.role === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const entries = await listSkillMembers({
      id: actor.skill.id,
      workspaceId: actor.skill.workspaceId,
      workspaceShared: actor.skill.workspaceShared,
    })

    const members = entries.map((entry) => ({
      ...entry,
      joinedAt: entry.joinedAt ? entry.joinedAt.toISOString() : null,
    }))

    return NextResponse.json({ members })
  } catch (error) {
    logger.error('Failed to fetch skill members', { error })
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

    const gate = await requireSkillAdmin(skillId, session.user.id)
    if (!gate.ok) {
      logger.warn('Skill member share denied', {
        skillId,
        actorId: session.user.id,
        reason: gate.reason,
      })
      return skillAdminGateResponse(gate.reason)
    }

    const parsed = await parseRequest(upsertSkillMemberContract, request, context)
    if (!parsed.success) return parsed.response

    const { userId, role } = parsed.data.body

    const targetWorkspacePerm = await getUserEntityPermissions(
      userId,
      'workspace',
      gate.workspaceId
    )
    if (targetWorkspacePerm === null) {
      return NextResponse.json({ error: 'User is not a member of this workspace' }, { status: 400 })
    }
    if (targetWorkspacePerm === 'admin' && role !== 'admin') {
      return NextResponse.json(
        { error: 'Workspace admins are automatically skill admins and cannot be demoted' },
        { status: 400 }
      )
    }

    const now = new Date()

    const [existing] = await db
      .select({ id: skillMember.id, role: skillMember.role, status: skillMember.status })
      .from(skillMember)
      .where(and(eq(skillMember.skillId, skillId), eq(skillMember.userId, userId)))
      .limit(1)

    const demotesActiveExplicitAdmin =
      role !== 'admin' && existing?.role === 'admin' && existing.status === 'active'

    // Upsert keyed on (skillId, userId) so concurrent adds cannot race the
    // unique index into a 500; also reactivates a revoked deny row (un-deny).
    const applied = await db.transaction(async (tx) => {
      if (!gate.workspaceShared && demotesActiveExplicitAdmin) {
        if (await wouldOrphanRestrictedSkill(tx, skillId)) return false
      }
      await tx
        .insert(skillMember)
        .values({
          id: generateId(),
          skillId,
          userId,
          role,
          status: 'active',
          joinedAt: now,
          invitedBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [skillMember.skillId, skillMember.userId],
          set: {
            role,
            status: 'active',
            joinedAt: sql`COALESCE(${skillMember.joinedAt}, excluded.joined_at)`,
            updatedAt: now,
          },
        })
      return true
    })
    if (!applied) {
      return NextResponse.json(
        { error: 'Cannot demote the last admin of a restricted skill' },
        { status: 400 }
      )
    }

    // A revoked row is a deny marker, so reactivating it is a fresh grant
    // (un-deny), not a role change — audit and count it as an add.
    if (existing && existing.status === 'active') {
      recordAudit({
        workspaceId: gate.workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.SKILL_MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.SKILL,
        resourceId: skillId,
        description: `Changed skill member role to "${role}"`,
        metadata: { targetUserId: userId, fromRole: existing.role, toRole: role },
        request,
      })

      return NextResponse.json({ success: true })
    }

    captureServerEvent(
      session.user.id,
      'skill_shared',
      { skill_id: skillId, role, workspace_id: gate.workspaceId },
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
      description: `Shared skill with member as "${role}"`,
      metadata: {
        targetUserId: userId,
        role,
        ...(existing ? { restoredAfterRemoval: true } : {}),
      },
      request,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    logger.error('Failed to add skill member', { error })
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

    const gate = await requireSkillAdmin(skillId, session.user.id)
    if (!gate.ok) {
      logger.warn('Skill member removal denied', {
        skillId,
        actorId: session.user.id,
        reason: gate.reason,
      })
      return skillAdminGateResponse(gate.reason)
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
        { error: 'Workspace admins are automatically skill admins and cannot be removed' },
        { status: 400 }
      )
    }

    const now = new Date()

    const [existing] = await db
      .select({ id: skillMember.id, role: skillMember.role, status: skillMember.status })
      .from(skillMember)
      .where(and(eq(skillMember.skillId, skillId), eq(skillMember.userId, targetUserId)))
      .limit(1)

    // Already removed (deny marker in place) reads as not-found, keeping
    // repeat removals from minting duplicate audit rows and analytics events.
    if (existing?.status === 'revoked') {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (!existing && !(gate.workspaceShared && targetWorkspacePerm !== null)) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const removesActiveExplicitAdmin = existing?.role === 'admin' && existing.status === 'active'

    // Upsert keyed on (skillId, userId): revokes an explicit row, or persists a
    // deny marker for an implicit (workspace-shared) member so the implicit
    // grant no longer applies. Conflict-safe against concurrent removals/adds.
    const applied = await db.transaction(async (tx) => {
      if (!gate.workspaceShared && removesActiveExplicitAdmin) {
        if (await wouldOrphanRestrictedSkill(tx, skillId)) return false
      }
      await tx
        .insert(skillMember)
        .values({
          id: generateId(),
          skillId,
          userId: targetUserId,
          role: 'member',
          status: 'revoked',
          invitedBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [skillMember.skillId, skillMember.userId],
          set: { status: 'revoked', updatedAt: now },
        })
      return true
    })
    if (!applied) {
      return NextResponse.json(
        { error: 'Cannot remove the last admin of a restricted skill' },
        { status: 400 }
      )
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
      description: 'Removed skill member',
      metadata: { targetUserId },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to remove skill member', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
