import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { collectUnquotedJsonStringReferences } from '@/lib/workflows/editing/lint'
import { getAllBlocks, getBlock, getBlockByToolName, getBlockRegistry } from '@/blocks/registry'

const mockGetBlock = getBlock as Mock
const mockGetAllBlocks = getAllBlocks as Mock
const mockGetBlockRegistry = getBlockRegistry as Mock
const mockGetBlockByToolName = getBlockByToolName as Mock
mockGetBlock.mockImplementation((type: string) => MOCK_BLOCKS[type])
mockGetAllBlocks.mockImplementation(() => Object.values(MOCK_BLOCKS))
mockGetBlockRegistry.mockImplementation(() => MOCK_BLOCKS)
mockGetBlockByToolName.mockImplementation(() => undefined)

/**
 * The few block shapes the check reads: which sub-blocks are JSON editors, and
 * the declared output types references resolve to.
 */
const MOCK_BLOCKS = vi.hoisted(
  () =>
    ({
      start_trigger: {
        type: 'start_trigger',
        category: 'triggers',
        subBlocks: [{ id: 'inputFormat', type: 'input-format' }],
        outputs: {},
        triggers: { enabled: true, available: ['chat', 'manual', 'api'] },
      },
      table_v2: {
        type: 'table_v2',
        category: 'blocks',
        subBlocks: [
          { id: 'operation', type: 'dropdown' },
          { id: 'data', type: 'code', language: 'json' },
          { id: 'rows', type: 'code', language: 'json' },
        ],
        outputs: {},
      },
      api: {
        type: 'api',
        category: 'blocks',
        subBlocks: [
          { id: 'url', type: 'short-input' },
          { id: 'body', type: 'code', language: 'json' },
        ],
        outputs: {},
      },
      function: {
        type: 'function',
        category: 'blocks',
        subBlocks: [{ id: 'code', type: 'code', language: 'javascript' }],
        outputs: {
          result: { type: 'json', description: 'Return value' },
          stdout: { type: 'string', description: 'Console output' },
        },
      },
      agent: {
        type: 'agent',
        category: 'blocks',
        subBlocks: [],
        outputs: {
          content: { type: 'string', description: 'Generated response content' },
          tokens: { type: 'json', description: 'Token usage' },
        },
      },
    }) as Record<string, unknown>
)

const START = {
  type: 'start_trigger',
  name: 'Start',
  subBlocks: {
    inputFormat: {
      value: [
        { name: 'order_id', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'paid', type: 'boolean' },
        { name: 'meta', type: 'object' },
      ],
    },
  },
}

function graph(
  blocks: Record<string, { type?: string; name?: string; subBlocks?: Record<string, unknown> }>
) {
  return { blocks } as Parameters<typeof collectUnquotedJsonStringReferences>[0]
}

function insertRow(data: unknown) {
  return { type: 'table_v2', name: 'Insert Order', subBlocks: { data: { value: data } } }
}

describe('collectUnquotedJsonStringReferences', () => {
  it('flags a string input pasted unquoted into Table row JSON', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        insert: insertRow(
          '{"order_id": <start.order_id>, "amount": <start.amount>, "status": "pending"}'
        ),
      })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      blockId: 'insert',
      blockName: 'Insert Order',
      field: 'data',
      kind: 'block-output',
      value: ['<start.order_id>'],
    })
    expect(findings[0]?.reason).toMatch(/^unquoted-json-string: /)
    expect(findings[0]?.reason).toContain('"<start.order_id>"')
  })

  it('flags every unquoted string reference in the field once, including agent text', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        writer: { type: 'agent', name: 'Writer' },
        call: {
          type: 'api',
          name: 'Post',
          subBlocks: {
            body: {
              value:
                '{"id": <start.order_id>, "again": <start.order_id>, "note": <writer.content>}',
            },
          },
        },
      })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.value).toEqual(['<start.order_id>', '<writer.content>'])
  })

  it('accepts quoted string references, including inside escaped quotes', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        insert: insertRow(
          '{"order_id": "<start.order_id>", "label": "id \\"<start.order_id>\\" ok", "tag": "a<b"}'
        ),
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('accepts unquoted references whose declared type is already a JSON value', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        build: { type: 'function', name: 'Build Row' },
        insert: insertRow(
          '{"amount": <start.amount>, "paid": <start.paid>, "meta": <start.meta>, "row": <buildrow.result>}'
        ),
        many: {
          type: 'table_v2',
          name: 'Insert Many',
          subBlocks: { rows: { value: '<buildrow.result>' } },
        },
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('leaves references of unknown type and unresolvable heads to the other checks', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        build: { type: 'function', name: 'Build Row' },
        insert: insertRow(
          '{"a": <buildrow.result.text>, "b": <start.missing>, "c": <ghost.value>, "d": <loop.currentItem>}'
        ),
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('ignores fields that are not JSON editors and non-string values', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        call: {
          type: 'api',
          name: 'Post',
          subBlocks: { url: { value: 'https://x.test/<start.order_id>' } },
        },
        fn: {
          type: 'function',
          name: 'Fn',
          subBlocks: { code: { value: 'return <start.order_id>' } },
        },
        insert: insertRow({ order_id: '<start.order_id>' }),
      })
    )
    expect(findings).toHaveLength(0)
  })
})
