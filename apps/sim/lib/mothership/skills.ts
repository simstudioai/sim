import { db, skill } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { ToolSchema } from '@/lib/copilot/chat/payload'

const logger = createLogger('MothershipUserSkills')

export const LOAD_USER_SKILL_TOOL_NAME = 'load_user_skill'

/**
 * Build the single load_user_skill tool that exposes all workspace
 * user-created skills to the mothership and its subagents.
 *
 * User skills live in the `skill` table (builtins are code-only and are treated
 * as defaults, so they are excluded here). The tool is a non-deferred,
 * sim-executed request-local tool: when the model calls it, Go forwards the
 * call and sim resolves the content via resolveSkillContent (see tools/index.ts).
 * It is available to all users — there is no super-admin gate, unlike the curated
 * mothership_settings tools.
 *
 * Embedded copilot/internal skills are not handled here: those are autoloaded
 * into each agent's system prompt on the Go side and never sent as loadable.
 */
export async function buildUserSkillTool(workspaceId: string): Promise<ToolSchema | null> {
  if (!workspaceId) return null

  let rows: { name: string; description: string }[]
  try {
    rows = await db
      .select({ name: skill.name, description: skill.description })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
  } catch (error) {
    logger.error('Failed to load workspace skills for load_user_skill tool', { error, workspaceId })
    return null
  }

  if (rows.length === 0) return null

  const skillNames = rows.map((r) => r.name)
  const catalog = rows.map((r) => `- ${r.name}: ${r.description}`).join('\n')

  return {
    name: LOAD_USER_SKILL_TOOL_NAME,
    description: `Load a user-created skill's full instructions. You MUST call this before following a skill: the list below only tells you which skills exist and when each applies — it is NOT the instructions. To use a skill, call load_user_skill with its exact name and follow the content it returns; never act on a skill's name or description alone. Available skills:\n${catalog}`,
    input_schema: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Exact name of the user skill to load.',
          enum: skillNames,
        },
      },
      required: ['skill_name'],
      additionalProperties: false,
    },
    // Do NOT set executeLocally: skill content is resolved on the sim backend
    // (DB), so Go must dispatch this with executor "sim". executeLocally maps to
    // ClientExecutable, which routes the call to the browser client (no handler)
    // and the load hangs. mothershipToolKind 'skill' is enough for sim routing.
    params: {
      mothershipToolKind: 'skill',
      mothershipToolName: LOAD_USER_SKILL_TOOL_NAME,
    },
  }
}
