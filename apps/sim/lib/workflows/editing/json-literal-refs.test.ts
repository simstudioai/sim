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
          {
            id: 'data',
            type: 'code',
            language: 'json',
            condition: { field: 'operation', value: ['insert_row', 'update_row'] },
          },
          { id: 'rows', type: 'code', language: 'json' },
          {
            id: 'filterBuilder',
            type: 'filter-builder',
            canonicalParamId: 'filterInput',
            mode: 'basic',
          },
          {
            id: 'filter',
            type: 'code',
            language: 'json',
            canonicalParamId: 'filterInput',
            mode: 'advanced',
          },
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
      response: {
        type: 'response',
        category: 'blocks',
        subBlocks: [
          { id: 'dataMode', type: 'dropdown' },
          {
            id: 'data',
            type: 'code',
            language: 'json',
            condition: { field: 'dataMode', value: 'json' },
          },
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
  blocks: Record<
    string,
    { type?: string; name?: string; subBlocks?: Record<string, unknown>; data?: unknown }
  >
) {
  return { blocks } as Parameters<typeof collectUnquotedJsonStringReferences>[0]
}

function insertRow(data: unknown, operation = 'insert_row') {
  return {
    type: 'table_v2',
    name: 'Insert Order',
    subBlocks: { operation: { value: operation }, data: { value: data } },
  }
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
  })

  /**
   * Quoting is only safe for text without a double quote, backslash, or control
   * character, since the text is inserted raw; free text such as a model reply has
   * to be built into JSON by a Function block instead.
   */
  it('advises quoting only for plain text and a Function block for free text', () => {
    const [finding] = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        insert: insertRow('{"order_id": <start.order_id>}'),
      })
    )
    expect(finding?.reason).toContain('"<start.order_id>"')
    expect(finding?.reason).toMatch(
      /double quote, backslash, line break, or other control character/
    )
    expect(finding?.reason).toMatch(/Function block/)
    expect(finding?.reason).not.toMatch(/Quote each one/)
  })

  /**
   * A field that is exactly one reference is the referenced value itself: the
   * Response block returns text it cannot parse as-is and the API block sends a
   * text body raw, while quoting it would turn JSON text into a JSON string.
   */
  it('accepts a field made only of string references, with no JSON around them', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        writer: { type: 'agent', name: 'Writer' },
        reply: {
          type: 'response',
          name: 'Reply',
          subBlocks: { dataMode: { value: 'json' }, data: { value: '<writer.content>' } },
        },
        call: {
          type: 'api',
          name: 'Post',
          subBlocks: { body: { value: '  <writer.content>\n' } },
        },
        signed: {
          type: 'api',
          name: 'Post Signed',
          subBlocks: { body: { value: '<writer.content>\n\n<writer.content>' } },
        },
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('still flags a string reference that sits inside JSON text around it', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        writer: { type: 'agent', name: 'Writer' },
        reply: {
          type: 'response',
          name: 'Reply',
          subBlocks: { dataMode: { value: 'json' }, data: { value: '[<writer.content>]' } },
        },
        call: {
          type: 'api',
          name: 'Post',
          subBlocks: { body: { value: '{"note": <writer.content>}' } },
        },
      })
    )
    expect(findings.map((finding) => finding.blockId)).toEqual(['reply', 'call'])
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

  it('ignores a JSON field the selected operation does not send', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        insert: insertRow('{"order_id": <start.order_id>}', 'get_schema'),
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('checks a JSON editor that is sent under its canonical parameter', () => {
    const findings = collectUnquotedJsonStringReferences(
      graph({
        start: START,
        query: {
          type: 'table_v2',
          name: 'Find Order',
          data: { canonicalModes: { filterInput: 'advanced' } },
          subBlocks: {
            operation: { value: 'query_rows' },
            filter: { value: '{"field": "order_id", "op": "eq", "value": <start.order_id>}' },
          },
        },
      })
    )
    expect(findings).toMatchObject([{ blockId: 'query', field: 'filter' }])
  })
})
