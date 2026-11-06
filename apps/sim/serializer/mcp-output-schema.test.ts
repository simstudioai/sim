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

  it('fails a reference to a field a closed schema does not declare', () => {
    const closed = createMcpToolOutputSnapshot('server-1', 'on_call', {
      ...ON_CALL_SCHEMA,
      additionalProperties: false,
    })
    expect(() => resolve(closed, ['structuredContent', 'onCall'])).toThrow(InvalidFieldError)
    expect(resolve(closed, ['structuredContent', 'role'])).toBe('sales-ops')
  })

  it('resolves an undeclared field of an object that does not close itself to empty', () => {
    expect(resolve(declared, ['structuredContent', 'onCall'])).toBeUndefined()
    expect(resolve(declared, ['structuredContent', 'person', 'email'])).toBeUndefined()
  })

  it('keeps the declared fields of an explicitly open object and accepts others', () => {
    const open = createMcpToolOutputSnapshot('server-1', 'on_call', {
      ...ON_CALL_SCHEMA,
      additionalProperties: { type: 'string' },
    })
    const schema = getBlockSchema(serializeMcpBlock(open))
    expect(schema?.structuredContent).toMatchObject({
      properties: { role: { type: 'string' }, person: { type: 'json' } },
    })
    expect(resolve(open, ['structuredContent', 'role'])).toBe('sales-ops')
    expect(resolve(open, ['structuredContent', 'onCall'])).toBeUndefined()
  })

  it('resolves a path inside the elements of an array that declares no items', () => {
    const untypedItems = createMcpToolOutputSnapshot('server-1', 'on_call', {
      type: 'object',
      properties: { rows: { type: 'array' } },
      additionalProperties: false,
    })
    expect(resolve(untypedItems, ['structuredContent', 'rows', '0', 'id'])).toBeUndefined()
  })

  it('checks a declared field named like the openness flag as a field', () => {
    const named = (additionalProperties?: false) =>
      createMcpToolOutputSnapshot('server-1', 'on_call', {
        type: 'object',
        properties: {
          open: {
            type: 'object',
            properties: { id: { type: 'string' } },
            ...(additionalProperties === false && { additionalProperties }),
          },
        },
        ...(additionalProperties === false && { additionalProperties }),
      })
    expect(resolve(named(), ['structuredContent', 'open', 'id'])).toBeUndefined()
    expect(resolve(named(), ['structuredContent', 'open', 'extra'])).toBeUndefined()
    expect(resolve(named(false), ['structuredContent', 'open', 'id'])).toBeUndefined()
    expect(() => resolve(named(false), ['structuredContent', 'open', 'extra'])).toThrow(
      InvalidFieldError
    )
  })

  it('rejects any field of a closed object that declares none', () => {
    const empty = createMcpToolOutputSnapshot('server-1', 'on_call', {
      type: 'object',
      additionalProperties: false,
    })
    expect(() => resolve(empty, ['structuredContent', 'onCall'])).toThrow(InvalidFieldError)
  })

  it('keeps a snapshot saved before openness was recorded closed until it is retaken', () => {
    const legacy = {
      server: 'server-1',
      tool: 'on_call',
      schema: { type: 'object', properties: { role: { type: 'string' } } },
    }
    expect(resolve(legacy, ['structuredContent', 'role'])).toBe('sales-ops')
    expect(() => resolve(legacy, ['structuredContent', 'onCall'])).toThrow(InvalidFieldError)
  })

  it('keeps content as declared alongside the typed output', () => {
    expect(resolve(declared, ['content', '0', 'text'])).toBe('{"role":"sales-ops"}')
  })

  it('keeps declared fields whose names are object built-ins', () => {
    const snapshot = createMcpToolOutputSnapshot(
      'server-1',
      'on_call',
      JSON.parse(
        '{"type":"object","properties":{"constructor":{"type":"string"},"__proto__":{"type":"number"}}}'
      )
    )
    expect(Object.keys(snapshot.schema?.properties ?? {})).toEqual(['constructor', '__proto__'])
  })

  it('leaves a schema wider than the snapshot budget open instead of saving every field', () => {
    const wide = createMcpToolOutputSnapshot('server-1', 'on_call', {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 2_000 }, (_, index) => [`field${index}`, { type: 'string' }])
      ),
    })
    expect(wide.schema).toEqual({ type: 'object' })
    expect(resolve(wide, ['structuredContent', 'role'])).toBe('sales-ops')
    expect(resolve(wide, ['structuredContent', 'anything'])).toBeUndefined()
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
