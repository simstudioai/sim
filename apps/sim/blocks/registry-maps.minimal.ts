import { AgentBlock } from '@/blocks/blocks/agent'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { NoteBlock } from '@/blocks/blocks/note'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock } from '@/blocks/blocks/router'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import type { BlockConfig, BlockMeta } from '@/blocks/types'

/**
 * Dev-only minimal block maps. Swapped in for `@/blocks/registry-maps` via a
 * resolve-alias when `SIM_DEV_MINIMAL_REGISTRY=1` (see next.config.ts) so the
 * dev server only compiles a curated core set of block configs instead of all
 * ~268. Only these blocks resolve in the editor/executor in minimal mode; unset
 * the flag for the full set. NEVER aliased in production.
 */
export const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  agent: AgentBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  chat_trigger: ChatTriggerBlock,
  condition: ConditionBlock,
  evaluator: EvaluatorBlock,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  input_trigger: InputTriggerBlock,
  knowledge: KnowledgeBlock,
  manual_trigger: ManualTriggerBlock,
  memory: MemoryBlock,
  note: NoteBlock,
  response: ResponseBlock,
  router: RouterBlock,
  schedule: ScheduleBlock,
  start_trigger: StartTriggerBlock,
  starter: StarterBlock,
  variables: VariablesBlock,
  workflow: WorkflowBlock,
}

export const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {}
