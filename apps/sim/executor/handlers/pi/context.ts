/**
 * Reuses the Agent block's skills and memory subsystems for Pi runs. Skills
 * resolve to full `{ name, content }` entries (so a backend can surface them as
 * Pi skills), and multi-turn memory goes through the shared `memoryService`
 * keyed by `memoryType`/`conversationId` — seeding the run and persisting the
 * user task plus the agent's final message.
 */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { memoryService } from '@/executor/handlers/agent/memory'
import { resolveSkillContentById } from '@/executor/handlers/agent/skills-resolver'
import type { AgentInputs, Message, SkillInput } from '@/executor/handlers/agent/types'
import type { PiMessage, PiSkill } from '@/executor/handlers/pi/backend'
import type { ExecutionContext } from '@/executor/types'

const logger = createLogger('PiContext')

/** Memory configuration — the Agent block's memory input fields, reused as-is. */
export type PiMemoryConfig = Pick<
  AgentInputs,
  'memoryType' | 'conversationId' | 'slidingWindowSize' | 'slidingWindowTokens' | 'model'
>

function isMemoryEnabled(config: PiMemoryConfig): boolean {
  return !!config.memoryType && config.memoryType !== 'none'
}

/** Resolves selected skill inputs to full `{ name, content }` entries for Pi. */
export async function resolvePiSkills(
  skillInputs: unknown,
  workspaceId: string | undefined
): Promise<PiSkill[]> {
  if (!Array.isArray(skillInputs) || !workspaceId) return []

  const skills: PiSkill[] = []
  for (const input of skillInputs as SkillInput[]) {
    if (!input?.skillId) continue
    try {
      const resolved = await resolveSkillContentById(input.skillId, workspaceId)
      if (resolved) skills.push({ name: resolved.name, content: resolved.content })
    } catch (error) {
      logger.warn('Failed to resolve skill for Pi', {
        skillId: input.skillId,
        error: getErrorMessage(error),
      })
    }
  }
  return skills
}

/** Loads prior conversation messages to seed the Pi run. */
export async function loadPiMemory(
  ctx: ExecutionContext,
  config: PiMemoryConfig
): Promise<PiMessage[]> {
  if (!isMemoryEnabled(config)) return []
  try {
    const messages = await memoryService.fetchMemoryMessages(ctx, config)
    return messages.map((message: Message) => ({ role: message.role, content: message.content }))
  } catch (error) {
    logger.warn('Failed to load Pi memory', { error: getErrorMessage(error) })
    return []
  }
}

/**
 * Builds the prompt: optional operating `guidance` (mode-specific constraints),
 * then skills, prior memory, and the task.
 */
export function buildPiPrompt(input: {
  skills: PiSkill[]
  initialMessages: PiMessage[]
  task: string
  guidance?: string
}): string {
  const parts: string[] = []

  if (input.guidance) {
    parts.push(`# Operating instructions\n${input.guidance}`)
  }

  if (input.skills.length > 0) {
    parts.push('# Available skills')
    for (const skill of input.skills) {
      parts.push(`## ${skill.name}\n${skill.content}`)
    }
  }

  if (input.initialMessages.length > 0) {
    parts.push('# Prior conversation')
    for (const message of input.initialMessages) {
      parts.push(`${message.role}: ${message.content}`)
    }
  }

  parts.push('# Task')
  parts.push(input.task)
  return parts.join('\n\n')
}

/** Persists the user task and the agent's final message to memory. */
export async function appendPiMemory(
  ctx: ExecutionContext,
  config: PiMemoryConfig,
  task: string,
  finalText: string
): Promise<void> {
  if (!isMemoryEnabled(config)) return
  try {
    await memoryService.appendToMemory(ctx, config, { role: 'user', content: task })
    if (finalText) {
      await memoryService.appendToMemory(ctx, config, { role: 'assistant', content: finalText })
    }
  } catch (error) {
    logger.warn('Failed to append Pi memory', { error: getErrorMessage(error) })
  }
}
