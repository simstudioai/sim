import { db } from '@sim/db'
import { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { canUseSkill, getSkillAccessForUser, type SkillAccessForUser } from '@/lib/skills/access'
import { getBuiltinSkillById, getBuiltinSkillByName } from '@/lib/workflows/skills/builtin-skills'
import type { SkillInput } from '@/executor/handlers/agent/types'

const logger = createLogger('SkillsResolver')

/**
 * The user on whose behalf skills are being resolved. Per-skill access rules
 * (explicit membership, revocation, workspace-shared) are applied only when
 * `enforce` is set with a `userId` — mirroring how credential access is only
 * enforced for interactive runs (`enforceCredentialAccess`); deployed
 * webhook/schedule runs resolve on the deployer's behalf unchecked.
 */
export interface SkillActorScope {
  userId?: string
  enforce?: boolean
}

/** Thrown when the acting user cannot access a skill they tried to load. */
export class SkillAccessDeniedError extends Error {
  constructor(skillName: string) {
    super(
      `You do not have access to skill "${skillName}". Ask the skill admin to add you as a member.`
    )
    this.name = 'SkillAccessDeniedError'
  }
}

/** Resolves batch access when enforcement applies, null otherwise. */
async function getEnforcedAccess(
  workspaceId: string,
  actor?: SkillActorScope
): Promise<SkillAccessForUser | null> {
  if (!actor?.enforce || !actor.userId) return null
  return getSkillAccessForUser(workspaceId, actor.userId)
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface SkillMetadata {
  name: string
  description: string
}

/**
 * Fetch skill metadata (name + description) for system prompt injection.
 * Only returns lightweight data so the LLM knows what skills are available.
 */
export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string,
  actor?: SkillActorScope
): Promise<SkillMetadata[]> {
  if (!skillInputs.length || !workspaceId) return []

  const metadata: SkillMetadata[] = []
  const dbSkillIds: string[] = []
  for (const input of skillInputs) {
    const builtin = getBuiltinSkillById(input.skillId)
    if (builtin) {
      metadata.push({ name: builtin.name, description: builtin.description })
    } else {
      dbSkillIds.push(input.skillId)
    }
  }

  if (dbSkillIds.length === 0) return metadata

  try {
    const rows = await db
      .select({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        workspaceShared: skill.workspaceShared,
      })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, dbSkillIds)))

    const access = await getEnforcedAccess(workspaceId, actor)
    const accessible = access ? rows.filter((row) => canUseSkill(row, access)) : rows

    if (access && accessible.length < rows.length) {
      logger.warn('Filtered attached skills the acting user cannot access', {
        workspaceId,
        userId: actor?.userId,
        filteredSkillIds: rows.filter((row) => !canUseSkill(row, access)).map((row) => row.id),
      })
    }

    return [
      ...metadata,
      ...accessible.map((row) => ({ name: row.name, description: row.description })),
    ]
  } catch (error) {
    logger.error('Failed to resolve skill metadata', { error, dbSkillIds, workspaceId })
    return metadata
  }
}

/**
 * Fetch full skill content for a load_skill tool response.
 * Called when the LLM decides a skill is relevant and invokes load_skill.
 */
export async function resolveSkillContent(
  skillName: string,
  workspaceId: string,
  actor?: SkillActorScope
): Promise<string | null> {
  if (!skillName || !workspaceId) return null

  const builtin = getBuiltinSkillByName(skillName)
  if (builtin) return builtin.content

  let rows: Array<{ id: string; content: string; name: string; workspaceShared: boolean }>
  try {
    rows = await db
      .select({
        id: skill.id,
        content: skill.content,
        name: skill.name,
        workspaceShared: skill.workspaceShared,
      })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, skillName)))
      .limit(1)
  } catch (error) {
    logger.error('Failed to resolve skill content', { error, skillName, workspaceId })
    return null
  }

  if (rows.length === 0) {
    logger.warn('Skill not found', { skillName, workspaceId })
    return null
  }

  const access = await getEnforcedAccess(workspaceId, actor)
  if (access && !canUseSkill(rows[0], access)) {
    logger.warn('Denied skill content load', { skillName, workspaceId, userId: actor?.userId })
    throw new SkillAccessDeniedError(rows[0].name)
  }

  return rows[0].content
}

export async function resolveSkillContentById(
  skillId: string,
  workspaceId: string,
  actor?: SkillActorScope
): Promise<{ name: string; content: string } | null> {
  if (!skillId || !workspaceId) return null

  const builtin = getBuiltinSkillById(skillId)
  if (builtin) return { name: builtin.name, content: builtin.content }

  let rows: Array<{ id: string; content: string; name: string; workspaceShared: boolean }>
  try {
    rows = await db
      .select({
        id: skill.id,
        content: skill.content,
        name: skill.name,
        workspaceShared: skill.workspaceShared,
      })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), eq(skill.id, skillId)))
      .limit(1)
  } catch (error) {
    logger.error('Failed to resolve skill content', { error, skillId, workspaceId })
    return null
  }

  if (rows.length === 0) {
    logger.warn('Skill not found', { skillId, workspaceId })
    return null
  }

  const access = await getEnforcedAccess(workspaceId, actor)
  if (access && !canUseSkill(rows[0], access)) {
    logger.warn('Denied skill content load', { skillId, workspaceId, userId: actor?.userId })
    throw new SkillAccessDeniedError(rows[0].name)
  }

  return { name: rows[0].name, content: rows[0].content }
}

/**
 * Build the system prompt section that lists available skills.
 * Uses XML format per the agentskills.io integration guide.
 */
export function buildSkillsSystemPromptSection(skills: SkillMetadata[]): string {
  if (!skills.length) return ''

  const skillEntries = skills
    .map(
      (s) =>
        `  <skill name="${escapeXml(s.name)}">\n    <description>${escapeXml(s.description)}</description>\n  </skill>`
    )
    .join('\n')

  return [
    '',
    'You have access to the following skills. Use the load_skill tool to activate a skill when relevant.',
    '',
    '<available_skills>',
    skillEntries,
    '</available_skills>',
  ].join('\n')
}

/**
 * Build the load_skill tool definition for injection into the tools array.
 * Returns a ProviderToolConfig-compatible object so all providers can process it.
 */
export function buildLoadSkillTool(skillNames: string[]) {
  return {
    id: 'load_skill',
    name: 'load_skill',
    description: `Load a skill to get specialized instructions. Available skills: ${skillNames.join(', ')}`,
    params: {},
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name of the skill to load',
          enum: skillNames,
        },
      },
      required: ['skill_name'],
    },
  }
}
