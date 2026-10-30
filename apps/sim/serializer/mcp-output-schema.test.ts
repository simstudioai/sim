import { createBlock } from '@sim/testing/factories'
import {
  blocksMock,
  createMockGetBlock,
  toolsMetadataMock,
  toolsUtilsMock,
} from '@sim/testing/mocks'
import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { createMcpToolOutputSnapshot } from '@/lib/mcp/output-schema'
import { McpBlock } from '@/blocks/blocks/mcp'
import { getBlock } from '@/blocks/registry'
import { getBlockSchema } from '@/executor/utils/block-data'
import { InvalidFieldError, resolveBlockReference } from '@/executor/utils/block-reference'
import { Serializer } from '@/serializer/index'
import { getToolMetadata, getToolParams } from '@/tools/metadata'

vi.mocked(getToolMetadata).mockImplementation(toolsMetadataMock.getToolMetadata)
vi.mocked(getToolParams).mockImplementation(toolsMetadataMock.getToolParams)
;(getBlock as Mock).mockImplementation(createMockGetBlock({ mcp: McpBlock }))

vi.mock('@/blocks', () => ({ ...blocksMock, getBlock: createMockGetBlock({ mcp: McpBlock }) }))
vi.mock('@/tools/utils', () => toolsUtilsMock)

const ON_CALL_SCHEMA = {
  type: 'object' as const,
  properties: {
    role: { type: 'string', description: 'Rotation <role.name>' },
    nickname: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    person: {
      type: 'object',
      properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['id'],
    },
  },
  required: ['role', 'person'],
}

const REPLY = {
  content: [{ type: 'text', text: '{"role":"sales-ops"}' }],
  structuredContent: { role: 'sales-ops', person: { id: 'u-1', tags: ['lead'] } },
}

function serializeMcpBlock(snapshot?: unknown) {
  const mcp = createBlock({
    id: 'mcp',
    name: 'On call',
    type: 'mcp',
    subBlocks: {
      operation: { id: 'operation', type: 'dropdown', value: 'run' },
      serverSelector: { id: 'serverSelector', type: 'mcp-server-selector', value: 'server-1' },
      toolSelector: { id: 'toolSelector', type: 'mcp-tool-selector', value: 'on_call' },
      arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: '{}' },
      ...(snapshot === undefined
        ? {}
        : { toolOutputSchema: { id: 'toolOutputSchema', type: 'code', value: snapshot } }),
    },
  })
  const [block] = new Serializer().serializeWorkflow({ mcp }, [], {}).blocks
  return block
}

function resolve(snapshot: unknown, path: string[]) {
  const block = serializeMcpBlock(snapshot)
  const schema = getBlockSchema(block)
  return resolveBlockReference('oncall', path, {
    blockNameMapping: { oncall: block.id },
    blockData: { [block.id]: REPLY },
    blockOutputSchemas: schema ? { [block.id]: schema } : {},
  })?.value
}

describe('MCP block output typed from a declared output schema', () => {
  const declared = createMcpToolOutputSnapshot('server-1', 'on_call', ON_CALL_SCHEMA)

  it('resolves declared structuredContent fields at run time', () => {
    expect(resolve(declared, ['structuredContent', 'person', 'id'])).toBe('u-1')
    expect(resolve(declared, ['structuredContent', 'person', 'tags', '0'])).toBe('lead')
  })

  it('resolves a declared field the reply omits to empty instead of failing the run', () => {
    expect(resolve(declared, ['structuredContent', 'nickname'])).toBeUndefined()
  })

  it('fails a reference to a field the schema does not declare', () => {
    expect(() => resolve(declared, ['structuredContent', 'onCall'])).toThrow(InvalidFieldError)
  })

  it('keeps content as declared alongside the typed output', () => {
    expect(resolve(declared, ['content', '0', 'text'])).toBe('{"role":"sales-ops"}')
  })

  it('carries the schema structure without description strings into block params', () => {
    const params = serializeMcpBlock(declared).config.params
    expect(params.toolOutputSchema).toEqual(declared)
    expect(JSON.stringify(params.toolOutputSchema)).not.toContain('<role.name>')
  })

  it.each([
    ['no snapshot', undefined],
    [
      'a snapshot for another operation',
      createMcpToolOutputSnapshot('server-1', 'add_note', ON_CALL_SCHEMA),
    ],
    [
      'a snapshot for another server',
      createMcpToolOutputSnapshot('server-2', 'on_call', ON_CALL_SCHEMA),
    ],
    [
      'an operation that declares no schema',
      createMcpToolOutputSnapshot('server-1', 'on_call', undefined),
    ],
    ['a malformed snapshot', { server: 'server-1', tool: 'on_call', schema: { type: 'tuple' } }],
  ])('declares only content with %s, as before', (_, snapshot) => {
    const schema = getBlockSchema(serializeMcpBlock(snapshot))
    expect(schema).not.toHaveProperty('structuredContent')
    expect(() => resolve(snapshot, ['structuredContent', 'nickname'])).toThrow(InvalidFieldError)
    expect(resolve(snapshot, ['structuredContent', 'role'])).toBe('sales-ops')
  })
})
