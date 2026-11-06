import type { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  skillContentSchema,
  skillDescriptionSchema,
  skillNameSchema,
} from '@/lib/api/contracts/skills'
import { ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { getSkillActorContext } from '@/lib/skills/access'
import { getBuiltinSkillByName, isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import {
  deleteSkill,
  getSkillById,
  type TouchedSkill,
  upsertSkills,
} from '@/lib/workflows/skills/operations'

const logger = createLogger('SkillOrchestration')

/**
 * Shared skill manager primitives.
 *
 * These throwing primitives own field validation, built-in guards, conflicts,
 * and per-skill editor checks. Authorized application use cases own workspace
 * authorization and semantic audit; each surface adapter owns its own analytics.
 */

/**
 * Skills need a `forbidden` outcome the shared code set does not carry: a
 * caller can hold workspace write and still not be an editor of a given skill.
 */
export type SkillOrchestrationErrorCode = OrchestrationErrorCode | 'forbidden'

type SkillRow = typeof skill.$inferSelect

/** Which surface performed the write. Recorded on the audit entry and the analytics event. */
export type SkillWriteSource = 'settings' | 'tool_input' | 'api'

export interface CreateSkillParams {
  workspaceId: string
  userId: string
  name: string
  description: string
  content: string
}

export interface UpdateSkillParams {
  workspaceId: string
  userId: string
  skillId: string
  name?: string
  description?: string
  content?: string
}

export interface DeleteSkillParams {
  workspaceId: string
  userId: string
  skillId: string
}

/** Classified failure passed between the internal guards and {@link throwSkillFailure}. */
interface SkillFailure {
  error: string
  errorCode: SkillOrchestrationErrorCode
}

function validationFailure(error: string): SkillFailure {
  return { error, errorCode: 'validation' }
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
}): Promise<{ ok: true; skill: SkillRow } | { ok: false; result: SkillFailure }> {
  if (isBuiltinSkillId(params.skillId)) {
    return {
      ok: false,
      result: validationFailure('Built-in skills are read-only and cannot be modified'),
    }
  }

  const actor = await getSkillActorContext(params.skillId, params.userId)
  if (!actor.skill || actor.skill.workspaceId !== params.workspaceId || !actor.hasWorkspaceAccess) {
    return { ok: false, result: { error: 'Skill not found', errorCode: 'not_found' } }
  }
  if (!actor.canEdit) {
    return {
      ok: false,
      result: {
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
function classifyUpsertError(error: unknown): SkillFailure {
  const message = getErrorMessage(error, 'Failed to save skill')
  if (getPostgresErrorCode(error) === '23505') {
    return { error: 'That skill name is unavailable in this workspace', errorCode: 'conflict' }
  }
  if (message.includes('is unavailable')) {
    return { error: message, errorCode: 'conflict' }
  }
  if (message.startsWith('Skill not found')) {
    return { error: 'Skill not found', errorCode: 'not_found' }
  }
  logger.error('Skill upsert failed', { error: message })
  return { error: 'Failed to save skill', errorCode: 'internal' }
}

/**
 * Editor access is the one skill refusal a workspace role cannot express, so it
 * is also the one that needs naming on the wire: a caller holding workspace
 * write sees the same `403` it would get for a role that is too low.
 */
function throwSkillFailure(result: SkillFailure): never {
  if (result.errorCode === 'forbidden') {
    throw new ForbiddenOperationError('SKILL_EDITOR_ACCESS_REQUIRED', result.error)
  }
  throw new OrchestrationError(result.errorCode, result.error)
}

/** One item of a batch upsert: no `id` creates, an `id` partially updates. */
export interface SkillUpsertItem {
  id?: string
  name?: string
  description?: string
  content?: string
}

export interface UpsertSkillBatchParams {
  workspaceId: string
  /**
   * The acting subject. Gates every update through the per-skill editor check
   * and is recorded as the owner of every row this batch creates.
   */
  userId: string
  skills: SkillUpsertItem[]
}

/** Field validation and the built-in name guard for a create item. */
function validateCreateItem(item: SkillUpsertItem): void {
  if (item.name === undefined || item.description === undefined || item.content === undefined) {
    throw new OrchestrationError(
      'validation',
      'Skill name, description, and content are required to create a skill'
    )
  }
  const invalid =
    fieldError(skillNameSchema, item.name) ??
    fieldError(skillDescriptionSchema, item.description) ??
    fieldError(skillContentSchema, item.content) ??
    builtinNameCollision(item.name)
  if (invalid) throw new OrchestrationError('validation', invalid)
}

/**
 * Field validation, the per-skill editor check, and the rename guard for an
 * update item. Reads only; the caller writes once every item has passed.
 */
async function validateUpdateItem(
  workspaceId: string,
  userId: string,
  skillId: string,
  item: SkillUpsertItem
): Promise<void> {
  if (item.name === undefined && item.description === undefined && item.content === undefined) {
    throw new OrchestrationError(
      'validation',
      'At least one of name, description, or content is required'
    )
  }

  const invalid =
    (item.name !== undefined ? fieldError(skillNameSchema, item.name) : null) ??
    (item.description !== undefined
      ? fieldError(skillDescriptionSchema, item.description)
      : null) ??
    (item.content !== undefined ? fieldError(skillContentSchema, item.content) : null)
  if (invalid) throw new OrchestrationError('validation', invalid)

  const resolved = await resolveEditableSkill({ workspaceId, userId, skillId })
  if (!resolved.ok) throwSkillFailure(resolved.result)

  // Only a rename can newly shadow a built-in. Rows predating the guard may already carry a
  // built-in's name, and the modal always resubmits the full object, so compare against the
  // canonical name rather than rejecting every write that echoes it back.
  if (item.name !== undefined && item.name !== resolved.skill.name) {
    const collision = builtinNameCollision(item.name)
    if (collision) throw new OrchestrationError('validation', collision)
  }
}

/**
 * Applies a mixed batch of creates and updates as one unit.
 *
 * Every item is validated and authorized first — no row is written until the
 * whole batch has passed — and the writes then run inside the single
 * `upsertSkills` transaction, so a rejected item leaves the earlier ones
 * unwritten instead of half-committing the batch.
 *
 * Workspace-level authorization is the caller's (the application use case's)
 * job. What lives here is the per-skill editor check an update needs, which
 * the workspace role cannot express.
 */
export async function upsertSkillBatch(
  params: UpsertSkillBatchParams
): Promise<readonly TouchedSkill[]> {
  if (params.skills.length === 0) return []

  for (const item of params.skills) {
    if (item.id) {
      await validateUpdateItem(params.workspaceId, params.userId, item.id, item)
      continue
    }
    validateCreateItem(item)
  }

  try {
    const { touched } = await upsertSkills({
      skills: params.skills.map((item) => ({
        ...(item.id !== undefined ? { id: item.id } : {}),
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(item.content !== undefined ? { content: item.content } : {}),
      })),
      workspaceId: params.workspaceId,
      userId: params.userId,
      returnSkills: false,
    })
    return touched
  } catch (error) {
    throwSkillFailure(classifyUpsertError(error))
  }
}

export async function createSkill(params: CreateSkillParams): Promise<SkillRow> {
  const [created] = await upsertSkillBatch({
    workspaceId: params.workspaceId,
    userId: params.userId,
    skills: [{ name: params.name, description: params.description, content: params.content }],
  })

  if (!created) {
    throw new Error(`Skill create returned no touched row for workspace ${params.workspaceId}`)
  }

  const row = await getSkillById({ skillId: created.id, workspaceId: params.workspaceId })
  if (!row) throw new Error(`Skill ${created.id} missing after a successful create`)
  return row
}

export async function updateSkill(params: UpdateSkillParams): Promise<SkillRow> {
  await upsertSkillBatch({
    workspaceId: params.workspaceId,
    userId: params.userId,
    skills: [
      {
        id: params.skillId,
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.content !== undefined ? { content: params.content } : {}),
      },
    ],
  })

  const row = await getSkillById({ skillId: params.skillId, workspaceId: params.workspaceId })
  if (!row) throw new OrchestrationError('not_found', 'Skill not found')
  return row
}

export async function deleteSkillRecord(params: DeleteSkillParams): Promise<SkillRow> {
  const resolved = await resolveEditableSkill(params)
  if (!resolved.ok) throwSkillFailure(resolved.result)

  const deleted = await deleteSkill({ skillId: params.skillId, workspaceId: params.workspaceId })
  if (!deleted) throw new OrchestrationError('not_found', 'Skill not found')
  return resolved.skill
}
