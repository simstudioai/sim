/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { chatOutputConfigSchema } from '@/lib/api/contracts/chats'
import { v2ChatDeploymentOutputConfigSchema } from '@/lib/api/contracts/v2/chat-deployments'

const OUTPUT_CONFIG_SCHEMAS = [chatOutputConfigSchema, v2ChatDeploymentOutputConfigSchema]

describe('chat output config contracts', () => {
  it.each(OUTPUT_CONFIG_SCHEMAS)('accepts child-workflow output selectors', (schema) => {
    expect(
      schema.safeParse({
        workflowId: 'child-workflow',
        blockId: 'agent-block',
        path: 'content.text',
      }).success
    ).toBe(true)
  })

  it.each(OUTPUT_CONFIG_SCHEMAS)(
    'rejects output selectors the executor cannot format',
    (schema) => {
      for (const config of [
        { blockId: '/agent-block', path: 'content' },
        { workflowId: 'workflow/child', blockId: 'agent-block', path: 'content' },
        { blockId: 'agent-block', path: '.content' },
        { blockId: 'agent-block', path: 'content.' },
        { blockId: 'agent-block', path: 'content..text' },
      ]) {
        expect(schema.safeParse(config).success).toBe(false)
      }
    }
  )
})
