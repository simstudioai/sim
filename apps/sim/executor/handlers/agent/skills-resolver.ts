import { db } from '@sim/db'
import { skill } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { SkillInput } from '@/executor/handlers/agent/types'

const logger = createLogger('SkillsResolver')

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
  workspaceId: string
): Promise<SkillMetadata[]> {
  if (!skillInputs.length || !workspaceId) return []

  const skillIds = skillInputs.map((s) => s.skillId)

  try {
    const rows = await db
      .select({ name: skill.name, description: skill.description })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, skillIds)))

    return rows
  } catch (error) {
    logger.error('Failed to resolve skill metadata', { error, skillIds, workspaceId })
    return []
  }
}

/**
 * Fetch full skill content for a load_skill tool response.
 * Called when the LLM decides a skill is relevant and invokes load_skill.
 */
export async function resolveSkillContent(
  skillName: string,
  workspaceId: string
): Promise<string | null> {
  if (!skillName || !workspaceId) return null

  try {
    const rows = await db
      .select({ content: skill.content, name: skill.name })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, skillName)))
      .limit(1)

    if (rows.length === 0) {
      logger.warn('Skill not found', { skillName, workspaceId })
      return null
    }

    return rows[0].content
  } catch (error) {
    logger.error('Failed to resolve skill content', { error, skillName, workspaceId })
    return null
  }
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
