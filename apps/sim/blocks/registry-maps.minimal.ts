import { A2ABlock } from '@/blocks/blocks/a2a'
import { AgentBlock } from '@/blocks/blocks/agent'
import { ApiBlock } from '@/blocks/blocks/api'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { CredentialBlock } from '@/blocks/blocks/credential'
import { DeploymentsBlock } from '@/blocks/blocks/deployments'
import { EnrichmentBlock } from '@/blocks/blocks/enrichment'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { FileV5Block } from '@/blocks/blocks/file'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GmailV2Block } from '@/blocks/blocks/gmail'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { ImapBlock } from '@/blocks/blocks/imap'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LogsV2Block } from '@/blocks/blocks/logs'
import { McpBlock } from '@/blocks/blocks/mcp'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { NoteBlock } from '@/blocks/blocks/note'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock } from '@/blocks/blocks/rss'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SimWorkspaceEventBlock } from '@/blocks/blocks/sim_workspace_event'
import { SlackBlock, SlackV2Block } from '@/blocks/blocks/slack'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { TableBlock } from '@/blocks/blocks/table'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import type { BlockConfig, BlockMeta } from '@/blocks/types'

/**
 * Dev-only minimal block maps. Swapped in for `@/blocks/registry-maps` via a
 * resolve-alias when `SIM_DEV_MINIMAL_REGISTRY=1` (see next.config.ts) so the
 * dev server only compiles a curated core set of block configs instead of all
 * ~268. The set is drawn from the canonical, toolbar-visible blocks
 * (`category: 'blocks'` / `'triggers'`, not `hideFromToolbar`, always the latest
 * version — never a superseded one). The ~247 `category: 'tools'` integrations
 * are excluded (that is the heavy graph minimal mode exists to skip) — except
 * `slack`/`slack_v2` and `gmail_v2`, kept as the everyday integrations (their
 * tools are likewise included in `tools/registry.minimal.ts`) — and so are
 * a few heavy or rarely-core-dev blocks pruned by hand: `mothership` and `pi`
 * (chunkiest configs), the media blocks `tts` / `stt_v2` / `image_generator_v2`
 * / `video_generator_v3`, and the `circleback` meeting-notetaker integration
 * trigger. Only these blocks resolve in the editor/executor in minimal mode;
 * unset the flag for the full set. NEVER aliased in production.
 */
export const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  a2a: A2ABlock,
  agent: AgentBlock,
  api: ApiBlock,
  condition: ConditionBlock,
  credential: CredentialBlock,
  deployments: DeploymentsBlock,
  enrichment: EnrichmentBlock,
  evaluator: EvaluatorBlock,
  file_v5: FileV5Block,
  function: FunctionBlock,
  gmail_v2: GmailV2Block,
  generic_webhook: GenericWebhookBlock,
  guardrails: GuardrailsBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  imap: ImapBlock,
  knowledge: KnowledgeBlock,
  logs_v2: LogsV2Block,
  mcp: McpBlock,
  memory: MemoryBlock,
  note: NoteBlock,
  response: ResponseBlock,
  router_v2: RouterV2Block,
  rss: RssBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  sim_workspace_event: SimWorkspaceEventBlock,
  slack: SlackBlock,
  slack_v2: SlackV2Block,
  start_trigger: StartTriggerBlock,
  table: TableBlock,
  translate: TranslateBlock,
  variables: VariablesBlock,
  wait: WaitBlock,
  webhook_request: WebhookRequestBlock,
  workflow_input: WorkflowInputBlock,
}

export const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {}
