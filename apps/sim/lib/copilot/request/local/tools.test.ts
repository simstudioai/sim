/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildLocalWorkspaceTools } from './tools'

describe('buildLocalWorkspaceTools', () => {
  it('exposes public Sim tools and request-scoped dynamic tools', () => {
    const tools = buildLocalWorkspaceTools({
      integrationTools: [
        {
          name: 'example_integration_action',
          description: 'Run an example integration action.',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          params: { credential: 'credential-id' },
        },
        {
          name: 'deferred_integration_action',
          description: 'This schema requires the managed deferred loader.',
          input_schema: { type: 'object', properties: {} },
          defer_loading: true,
        },
      ],
    })

    expect(tools.find((tool) => tool.id === 'user_table')).toMatchObject({
      name: 'user_table',
      parameters: { type: 'object' },
    })
    expect(tools.find((tool) => tool.id === 'example_integration_action')).toMatchObject({
      description: 'Run an example integration action.',
      params: { credential: 'credential-id' },
      parameters: { required: ['query'] },
    })
    expect(tools.some((tool) => tool.id === 'research')).toBe(false)
    expect(tools.some((tool) => tool.id === 'auth')).toBe(false)
    expect(tools.some((tool) => tool.id === 'load_integration_tool')).toBe(false)
    expect(tools.some((tool) => tool.id === 'deferred_integration_action')).toBe(false)
  })
})
