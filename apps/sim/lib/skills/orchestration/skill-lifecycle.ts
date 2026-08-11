import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import {
  skillContentSchema,
  skillDescriptionSchema,
  skillNameSchema,
} from '@/lib/api/contracts/skills'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationErrorCode,
} from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { getSkillActorContext } from '@/lib/skills/access'
import { getBuiltinSkillByName, isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { deleteSkill, getSkillById, upsertSkills } from '@/lib/workflows/skills/operations'

const logger = createLogger('SkillOrchestration')

/**
 * Shared skill manager primitives and legacy orchestration adapters.
 *
 * The throwing primitives own field validation, built-in guards, conflicts,
 * and per-skill editor checks. Authorized application use cases own workspace
 * authorization and semantic audit. The `perform*` adapters preserve internal
 * route result, audit, and analytics compatibility.
 */

/**
 * Skills need a `forbidden` outcome the shared code set does not carry: a
 * caller can hold workspace write and still not be an editor of a given skill.
 */
export type SkillOrchestrationErrorCode = OrchestrationErrorCode | 'forbidden'

/** HTTP status for a skill orchestration failure, shared by every route surface. */
export function statusForSkillOrchestrationError(
  code: SkillOrchestrationErrorCode | undefined
): number {
  if (code === 'validation') return 400
  if (code === 'forbidden') return 403
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  return 500
}

type SkillRow = typeof skill.$inferSelect

/** Which surface performed the write. Recorded on the audit entry and the analytics event. */
export type SkillWriteSource = 'settings' | 'tool_input' | 'api'

interface ActorMetadata {
  actorName?: string | null
  actorEmail?: string | null
  source?: SkillWriteSource
  request?: NextRequest
}

export interface PerformCreateSkillParams extends ActorMetadata {
  workspaceId: string
  userId: string
  name: string
  description: string
  content: string
}

export interface PerformUpdateSkillParams extends ActorMetadata {
  workspaceId: string
  userId: string
  skillId: string
  name?: string
  description?: string
  content?: string
}

export interface PerformDeleteSkillParams extends ActorMetadata {
  workspaceId: string
  userId: string
  skillId: string
}

export interface PerformSkillResult {
  success: boolean
  error?: string
  errorCode?: SkillOrchestrationErrorCode
  skill?: SkillRow
}

function validationFailure(error: string): PerformSkillResult {
  return { success: false, error, errorCode: 'validation' }
}

/** First message from a failed field parse, or null when the value is valid. */
function fieldError(schema: z.ZodType, value: unknown): string | null {
  const parsed = schema.safeParse(value)
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Invalid value')
}

/**
 * A workspace skill sharing a built-in's name silently shadows it everywhere the
 * two lists are merged. Reject the collision at the write instead of resolving
 * it at every read.
 */
function builtinNameCollision(name: string): string | null {
  return getBuiltinSkillByName(name)
    ? `The skill name "${name}" is reserved by a built-in skill`
    : null
}

/**
 * Resolves the acting user's edit rights over an existing workspace skill.
 * Returns the loaded row, or the failure to surface.
 */
async function resolveEditableSkill(params: {
  workspaceId: string
  userId: string
  skillId: string
}): Promise<{ ok: true; skill: SkillRow } | { ok: false; result: PerformSkillResult }> {
  if (isBuiltinSkillId(params.skillId)) {
    return {
      ok: false,
      result: validationFailure('Built-in skills are read-only and cannot be modified'),
    }
  }

  const actor = await getSkillActorContext(params.skillId, params.userId)
  if (!actor.skill || actor.skill.workspaceId !== params.workspaceId || !actor.hasWorkspaceAccess) {
    return {
      ok: false,
      result: { success: false, error: 'Skill not found', errorCode: 'not_found' },
    }
  }
  if (!actor.canEdit) {
    return {
      ok: false,
      result: {
        success: false,
        error: `Skill editor access required to modify "${actor.skill.name}"`,
        errorCode: 'forbidden',
      },
    }
  }
  return { ok: true, skill: actor.skill }
}

/**
 * `upsertSkills` reports name collisions and vanished ids as thrown Errors.
 * Classify them rather than letting every caller re-match the message.
 *
 * The `23505` arm covers the race its in-transaction name `SELECT` cannot: two
 * concurrent creates (or renames) both pass that check, and the loser is rejected
 * by `skill_workspace_name_unique` as a raw Postgres error whose message matches
 * nothing here — which would otherwise surface as a 500 for what is a conflict.
 */
function classifyUpsertError(error: unknown): PerformSkillResult {
  const message = getErrorMessage(error, 'Failed to save skill')
  if (getPostgresErrorCode(error) === '23505') {
    return {
      success: false,
      error: 'That skill name is unavailable in this workspace',
      errorCode: 'conflict',
    }
  }
  if (message.includes('is unavailable')) {
    return { success: false, error: message, errorCode: 'conflict' }
  }
  if (message.startsWith('Skill not found')) {
    return { success: false, error: 'Skill not found', errorCode: 'not_found' }
  }
  logger.error('Skill upsert failed', { error: message })
  return { success: false, error: 'Failed to save skill', errorCode: 'internal' }
}

type SkillLifecycleAction = 'created' | 'updated' | 'deleted'

const AUDIT_ACTION = {
  created: AuditAction.SKILL_CREATED,
  updated: AuditAction.SKILL_UPDATED,
  deleted: AuditAction.SKILL_DELETED,
} as const satisfies Record<SkillLifecycleAction, string>

const AUDIT_VERB = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
} as const satisfies Record<SkillLifecycleAction, string>

function recordSkillEvent(params: {
  action: SkillLifecycleAction
  workspaceId: string
  userId: string
  skillId: string
  skillName: string
  actor: ActorMetadata
}): void {
  const { action, workspaceId, userId, skillId, skillName, actor } = params

  recordAudit({
    workspaceId,
    actorId: userId,
    actorName: actor.actorName ?? undefined,
    actorEmail: actor.actorEmail ?? undefined,
    action: AUDIT_ACTION[action],
    resourceType: AuditResourceType.SKILL,
    resourceId: skillId,
    resourceName: skillName,
    description: `${AUDIT_VERB[action]} skill "${skillName}"`,
    metadata: { source: actor.source },
    request: actor.request,
  })

  // The delete event carries no skill_name — the skill no longer exists to name.
  if (action === 'deleted') {
    captureServerEvent(
      userId,
      'skill_deleted',
      { skill_id: skillId, workspace_id: workspaceId, source: actor.source },
      { groups: { workspace: workspaceId } }
    )
    return
  }

  captureServerEvent(
    userId,
    action === 'created' ? 'skill_created' : 'skill_updated',
    {
      skill_id: skillId,
      skill_name: skillName,
      workspace_id: workspaceId,
      source: actor.source,
    },
    { groups: { workspace: workspaceId } }
  )
}

export async function performCreateSkill(
  params: PerformCreateSkillParams
): Promise<PerformSkillResult> {
  try {
    const skill = await createSkill(params)
    recordSkillEvent({
      action: 'created',
      workspaceId: params.workspaceId,
      userId: params.userId,
      skillId: skill.id,
      skillName: skill.name,
      actor: params,
    })
    return { success: true, skill }
  } catch (error) {
    return skillFailureResult(error, 'Failed to create skill')
  }
}

function throwSkillFailure(result: PerformSkillResult): never {
  throw new OrchestrationError(
    result.errorCode ?? 'internal',
    result.error ?? 'Skill operation failed'
  )
}

function skillFailureResult(error: unknown, fallback: string): PerformSkillResult {
  const classified = asOrchestrationError(error)
  if (classified) {
    return { success: false, error: classified.message, errorCode: classified.code }
  }
  logger.error(fallback, { error: getErrorMessage(error, fallback) })
  return { success: false, error: fallback, errorCode: 'internal' }
}

export async function createSkill(
  params: Omit<PerformCreateSkillParams, keyof ActorMetadata>
): Promise<SkillRow> {
  const invalid =
    fieldError(skillNameSchema, params.name) ??
    fieldError(skillDescriptionSchema, params.description) ??
    fieldError(skillContentSchema, params.content) ??
    builtinNameCollision(params.name)
  if (invalid) throw new OrchestrationError('validation', invalid)

  let created: { id: string; name: string } | undefined
  try {
    const { touched } = await upsertSkills({
      skills: [{ name: params.name, description: params.description, content: params.content }],
      workspaceId: params.workspaceId,
      userId: params.userId,
      returnSkills: false,
    })
    created = touched[0]
  } catch (error) {
    throwSkillFailure(classifyUpsertError(error))
  }

  if (!created) {
    throw new Error(`Skill create returned no touched row for workspace ${params.workspaceId}`)
  }

  const row = await getSkillById({ skillId: created.id, workspaceId: params.workspaceId })
  if (!row) throw new Error(`Skill ${created.id} missing after a successful create`)
  return row
}

export async function performUpdateSkill(
  params: PerformUpdateSkillParams
): Promise<PerformSkillResult> {
  try {
    const skill = await updateSkill(params)
    recordSkillEvent({
      action: 'updated',
      workspaceId: params.workspaceId,
      userId: params.userId,
      skillId: skill.id,
      skillName: skill.name,
      actor: params,
    })
    return { success: true, skill }
  } catch (error) {
    return skillFailureResult(error, 'Failed to update skill')
  }
}

export async function updateSkill(
  params: Omit<PerformUpdateSkillParams, keyof ActorMetadata>
): Promise<SkillRow> {
  if (
    params.name === undefined &&
    params.description === undefined &&
    params.content === undefined
  ) {
    throw new OrchestrationError(
      'validation',
      'At least one of name, description, or content is required'
    )
  }

  const invalid =
    (params.name !== undefined ? fieldError(skillNameSchema, params.name) : null) ??
    (params.description !== undefined
      ? fieldError(skillDescriptionSchema, params.description)
      : null) ??
    (params.content !== undefined ? fieldError(skillContentSchema, params.content) : null)
  if (invalid) throw new OrchestrationError('validation', invalid)

  const resolved = await resolveEditableSkill(params)
  if (!resolved.ok) throwSkillFailure(resolved.result)

  /**
   * Only a rename can newly shadow a built-in, so the guard runs against the
   * canonical name rather than the submitted one. Rows predating the guard may
   * already carry a built-in's name, and the skill modal always submits the
   * full object — re-sending that unchanged name is not a new collision.
   */
  if (params.name !== undefined && params.name !== resolved.skill.name) {
    const collision = builtinNameCollision(params.name)
    if (collision) throw new OrchestrationError('validation', collision)
  }

  try {
    await upsertSkills({
      skills: [
        {
          id: params.skillId,
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
          ...(params.content !== undefined ? { content: params.content } : {}),
        },
      ],
      workspaceId: params.workspaceId,
      userId: params.userId,
      returnSkills: false,
    })
  } catch (error) {
    throwSkillFailure(classifyUpsertError(error))
  }

  const row = await getSkillById({ skillId: params.skillId, workspaceId: params.workspaceId })
  if (!row) throw new OrchestrationError('not_found', 'Skill not found')
  return row
}

export async function performDeleteSkill(
  params: PerformDeleteSkillParams
): Promise<PerformSkillResult> {
  try {
    const skill = await deleteSkillRecord(params)
    recordSkillEvent({
      action: 'deleted',
      workspaceId: params.workspaceId,
      userId: params.userId,
      skillId: skill.id,
      skillName: skill.name,
      actor: params,
    })
    return { success: true, skill }
  } catch (error) {
    return skillFailureResult(error, 'Failed to delete skill')
  }
}

export async function deleteSkillRecord(
  params: Omit<PerformDeleteSkillParams, keyof ActorMetadata>
): Promise<SkillRow> {
  const resolved = await resolveEditableSkill(params)
  if (!resolved.ok) throwSkillFailure(resolved.result)

  const deleted = await deleteSkill({ skillId: params.skillId, workspaceId: params.workspaceId })
  if (!deleted) throw new OrchestrationError('not_found', 'Skill not found')
  return resolved.skill
}
