import type { OutputFieldDefinition } from '@/blocks/types'

/**
 * The outputs the unified Start block (`start_trigger`) always has, before its input format adds
 * fields: the runtime builds them (`buildUnifiedStartOutput`), the block config declares none. The
 * editor's output resolution and the workflow-code catalog both read them here.
 */
export const UNIFIED_START_OUTPUTS: Record<string, OutputFieldDefinition> = {
  input: { type: 'string', description: 'Primary user input or message' },
  conversationId: { type: 'string', description: 'Conversation thread identifier' },
  files: { type: 'file[]', description: 'User uploaded files' },
}
