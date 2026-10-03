import { describe, expect, it } from 'vitest'
import {
  getToolBindingAuthoringSchema,
  validateToolBindingAuthoring,
} from '@/lib/workflows/tool-input/authoring'

const integration = { type: 'slack', operation: 'send_message', params: { channel: 'support' } }
const mcp = { type: 'mcp', params: { serverId: 'server-1', toolName: 'search_docs' } }

describe('tool binding authoring contract', () => {
  it.each(['title', 'name', 'toolId', 'functionName'])(
    'rejects new %s overrides, using the same shape discovery publishes',
    (key) => {
      const tools = [{ ...integration, [key]: 'approved_sender' }]
      expect(getToolBindingAuthoringSchema('agent')?.safeParse(tools).success).toBe(false)
      expect(validateToolBindingAuthoring('agent', tools)).toContain('read-only')
    }
  )

  it('preserves existing display labels while changing parameters or reordering tools', () => {
    const saved = [{ ...integration, title: 'Old UI label' }, mcp]
    const edited = [mcp, { ...saved[0], params: { channel: 'engineering' } }]
    expect(validateToolBindingAuthoring('agent', edited, saved)).toBeUndefined()
    expect(edited[1]).toHaveProperty('title', 'Old UI label')
    expect(
      validateToolBindingAuthoring('agent', [{ ...saved[0], title: 'New alias' }], saved)
    ).toContain('read-only')
  })

  it('does not grant an existing label to a different operation or an extra binding', () => {
    const saved = [{ ...integration, title: 'Old UI label' }]
    expect(
      validateToolBindingAuthoring('agent', [{ ...saved[0], operation: 'delete_message' }], saved)
    ).toContain('read-only')
    expect(validateToolBindingAuthoring('agent', [saved[0], saved[0]], saved)).toContain(
      'read-only'
    )
  })

  it('accepts saved custom tools without a binding alias and inline definitions with matching names', () => {
    const inline = {
      type: 'custom-tool',
      title: 'lookup',
      code: 'return 1',
      schema: { function: { name: 'lookup', parameters: { type: 'object' } } },
    }
    expect(
      validateToolBindingAuthoring('agent', [
        { type: 'custom-tool', customToolId: 'custom-1' },
        inline,
      ])
    ).toBeUndefined()
    expect(validateToolBindingAuthoring('agent', [{ ...inline, title: 'wrong' }])).toContain(
      'must equal'
    )
    expect(validateToolBindingAuthoring('agent', [{ ...inline, title: undefined }])).toContain(
      'must equal'
    )
  })

  it('publishes and validates the narrower Sim Chat MCP contract', () => {
    const accepted = [
      mcp,
      { ...mcp, usageControl: 'force' },
      { ...mcp, usageControlExpression: '<start.mode>' },
      {
        type: 'mcp-server-advanced',
        params: { serverId: 'server-2' },
        usageControlExpression: '<start.mode>',
      },
    ]
    expect(getToolBindingAuthoringSchema('mothership')?.safeParse(accepted).success).toBe(true)
    expect(validateToolBindingAuthoring('mothership', accepted)).toBeUndefined()
    for (const tool of [
      integration,
      { type: 'custom-tool', customToolId: 'custom-1' },
      { ...mcp, usageControl: 'sometimes' },
      { ...mcp, params: { ...mcp.params, query: 'fixed' } },
    ]) {
      expect(getToolBindingAuthoringSchema('mothership')?.safeParse([tool]).success).toBe(false)
      expect(validateToolBindingAuthoring('mothership', [tool])).toContain('blocks get mothership')
    }
  })

  it('rejects fixed arguments that a saved custom-tool reference would discard', () => {
    const tools = [{ type: 'custom-tool', customToolId: 'custom-1', params: { query: 'fixed' } }]
    expect(getToolBindingAuthoringSchema('agent')?.safeParse(tools).success).toBe(false)
    expect(validateToolBindingAuthoring('agent', tools)).toContain('invalid tool binding')
  })

  it('allows code edits to an existing inline definition without requiring a naming migration', () => {
    const saved = [
      {
        type: 'custom-tool',
        title: 'Historical title',
        code: 'return 1',
        schema: { function: { name: 'historical_name', parameters: { type: 'object' } } },
      },
    ]
    expect(
      validateToolBindingAuthoring('agent', [{ ...saved[0], code: 'return 2' }], saved)
    ).toBeUndefined()
    expect(validateToolBindingAuthoring('agent', [{ ...saved[0], code: 'return 2' }])).toContain(
      'must equal'
    )
  })

  it('leaves unchanged saved selections intact, even when new authoring would reject them', () => {
    const old = [{ ...integration, title: 'Existing' }]
    expect(validateToolBindingAuthoring('mothership', structuredClone(old), old)).toBeUndefined()
    expect(validateToolBindingAuthoring('mothership', old)).toContain('read-only')
    expect(getToolBindingAuthoringSchema('pi')).toBeUndefined()
    const fromEditor = old.map((tool) => ({ ...tool, isExpanded: true }))
    expect(validateToolBindingAuthoring('mothership', old, fromEditor)).toBeUndefined()
  })
})
