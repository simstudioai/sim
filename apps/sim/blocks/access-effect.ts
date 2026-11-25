import { getToolMetadata } from '@/tools/metadata'
import type { ToolEffect } from '@/tools/types'

/**
 * The `tools.access` of a block that calls a model (Agent, Router, Evaluator): one id per model
 * provider it may call, not a registered tool.
 */
export const MODEL_PROVIDER_ACCESS_IDS: readonly string[] = [
  'openai_chat',
  'anthropic_chat',
  'google_chat',
  'xai_chat',
  'deepseek_chat',
  'deepseek_reasoner',
]

const MODEL_PROVIDER_ACCESS_ID_SET: ReadonlySet<string> = new Set(MODEL_PROVIDER_ACCESS_IDS)

/**
 * The effect of one `tools.access` id: a registered tool's declared effect; `read` for a model
 * provider, since a model call changes nothing outside Sim and a dry run sends it; `write` for any
 * other id, which declares nothing. A block that also runs tools its user chooses is a writer
 * whatever its access ids say.
 */
export function accessIdEffect(id: string): ToolEffect {
  return getToolMetadata(id)?.effect ?? (MODEL_PROVIDER_ACCESS_ID_SET.has(id) ? 'read' : 'write')
}
