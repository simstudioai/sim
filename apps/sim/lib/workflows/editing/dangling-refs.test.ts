import { describe, expect, it, vi } from 'vitest'
import { collectDanglingBlockOutputReferences } from '@/lib/workflows/editing/lint'

/**
 * Overrides the global registry stub (every type resolves to a block with no
 * outputs) with the handful of real output shapes the unknown-field pass reads.
 */
const MOCK_BLOCKS = vi.hoisted(
  () =>
    ({
      starter: { type: 'starter', category: 'triggers', subBlocks: [], outputs: {} },
      start_trigger: {
        type: 'start_trigger',
        category: 'triggers',
        subBlocks: [{ id: 'inputFormat', type: 'input-format' }],
        outputs: {},
        triggers: { enabled: true, available: ['chat', 'manual', 'api'] },
      },
      api: {
        type: 'api',
        category: 'blocks',
        subBlocks: [],
        outputs: {
          data: { type: 'json', description: 'Response data' },
          status: { type: 'number', description: 'HTTP status' },
          headers: { type: 'json', description: 'Response headers' },
        },
      },
      function: {
        type: 'function',
        category: 'blocks',
        subBlocks: [],
        outputs: {
          result: { type: 'json', description: 'Return value' },
          stdout: { type: 'string', description: 'Console output' },
          files: { type: 'file[]', description: 'Files written' },
        },
      },
      agent: {
        type: 'agent',
        category: 'blocks',
        subBlocks: [],
        outputs: {
          content: { type: 'string', description: 'Generated response content' },
          model: { type: 'string', description: 'Model used' },
          tokens: { type: 'json', description: 'Token usage' },
          toolCalls: { type: 'json', description: 'Tool calls made' },
        },
      },
      table: {
        type: 'table',
        category: 'blocks',
        subBlocks: [],
        outputs: { success: { type: 'boolean', description: 'Operation success' } },
      },
      slack: { type: 'slack', category: 'blocks', subBlocks: [], outputs: {} },
      workflow_input: { type: 'workflow_input', category: 'blocks', subBlocks: [], outputs: {} },
    }) as Record<string, unknown>
)

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) => MOCK_BLOCKS[type],
  getAllBlocks: () => Object.values(MOCK_BLOCKS),
  getLatestBlock: () => undefined,
  getLatestBlockForViewer: () => undefined,
  getBlockMeta: () => undefined,
  getBlockRegistry: () => MOCK_BLOCKS,
  getBlockByToolName: () => undefined,
}))

function graph(
  blocks: Record<
    string,
    {
      type?: string
      name?: string
      triggerMode?: boolean
      subBlocks?: Record<string, { value?: unknown }>
    }
  >
) {
  return { blocks } as Parameters<typeof collectDanglingBlockOutputReferences>[0]
}

describe('collectDanglingBlockOutputReferences', () => {
  it('flags a reference to a deleted block in an API body', () => {
    const findings = collectDanglingBlockOutputReferences(
      graph({
        b1: {
          type: 'api',
          name: 'PostBack',
          subBlocks: { body: { value: '{"spec": "<attachformspec.result>"}' } },
        },
      })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      blockId: 'b1',
      field: 'body',
      kind: 'block-output',
      value: ['<attachformspec.result>'],
    })
  })

  it('resolves heads by normalized block name, id, and special prefixes', () => {
    const findings = collectDanglingBlockOutputReferences(
      graph({
        b1: { type: 'starter', name: 'Start' },
        b2: {
          type: 'api',
          name: 'Call',
          subBlocks: {
            url: { value: 'https://x.test/<start.input>' },
            body: { value: '<loop.index> and <b1.input> are fine' },
          },
        },
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('ignores non-reference angle text (Slack links, comparisons, bare tags)', () => {
    const findings = collectDanglingBlockOutputReferences(
      graph({
        b1: {
          type: 'slack',
          name: 'Notify',
          subBlocks: {
            text: { value: 'See <https://sim.ai|the docs> or <b>bold</b>, math a<b.c && d>e' },
          },
        },
      })
    )
    expect(findings).toHaveLength(0)
  })

  it('flags a deleted block referenced from function code', () => {
    const findings = collectDanglingBlockOutputReferences(
      graph({
        b1: {
          type: 'function',
          name: 'Fn',
          subBlocks: { code: { value: 'const rows = <deletedblock.rows>\nreturn rows' } },
        },
      })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      blockId: 'b1',
      field: 'code',
      kind: 'block-output',
      value: ['<deletedblock.rows>'],
    })
  })

  it('walks nested values like inputMapping objects', () => {
    const findings = collectDanglingBlockOutputReferences(
      graph({
        b1: {
          type: 'workflow_input',
          name: 'Invoke',
          subBlocks: { inputMapping: { value: { lead: '<ghostblock.output.lead>' } } },
        },
      })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.field).toBe('inputMapping')
  })

  describe('unknown output fields', () => {
    it('flags a path whose head resolves but whose first segment is not a declared output', () => {
      const findings = collectDanglingBlockOutputReferences(
        graph({
          b1: { type: 'function', name: 'Guard' },
          b2: {
            type: 'api',
            name: 'Call',
            subBlocks: { body: { value: '{"a": "<guard.reslt>", "b": "<guard.result.rows>"}' } },
          },
        })
      )
      expect(findings).toHaveLength(1)
      expect(findings[0]).toMatchObject({
        blockId: 'b2',
        field: 'body',
        kind: 'block-output',
        value: ['<guard.reslt>'],
      })
      expect(findings[0]!.reason).toMatch(
        /^unknown-field: "Guard" \(function\) has no output field "reslt"/
      )
      expect(findings[0]!.reason).toContain('Available fields: result, stdout, files')
    })

    it('accepts the implicit error output on every block', () => {
      const findings = collectDanglingBlockOutputReferences(
        graph({
          b1: { type: 'function', name: 'Guard' },
          b2: {
            type: 'function',
            name: 'Collector',
            subBlocks: {
              code: { value: 'return { failure: <guard.error>, out: <guard.result> }' },
            },
          },
        })
      )
      expect(findings).toHaveLength(0)
    })

    it('flags a base output on an agent whose responseFormat replaces its outputs', () => {
      const responseFormat = JSON.stringify({
        type: 'object',
        properties: { title: { type: 'string' }, summary: { type: 'string' } },
      })
      const findings = collectDanglingBlockOutputReferences(
        graph({
          b1: {
            type: 'agent',
            name: 'AccessAgent',
            subBlocks: { responseFormat: { value: responseFormat } },
          },
          b2: {
            type: 'api',
            name: 'Post',
            subBlocks: { body: { value: '<accessagent.content> and <accessagent.title>' } },
          },
        })
      )
      expect(findings).toHaveLength(1)
      expect(findings[0]!.value).toEqual(['<accessagent.content>'])
      expect(findings[0]!.reason).toContain('Available fields: title, summary')
    })

    it('does not flag an agent whose responseFormat cannot be parsed', () => {
      const findings = collectDanglingBlockOutputReferences(
        graph({
          start: { type: 'starter', name: 'Start' },
          b1: {
            type: 'agent',
            name: 'Writer',
            subBlocks: { responseFormat: { value: '<start.schema>' } },
          },
          b2: { type: 'api', name: 'Post', subBlocks: { body: { value: '<writer.anything>' } } },
        })
      )
      expect(findings).toHaveLength(0)
    })

    it('does not flag dynamic-output blocks: triggers, subflow containers, tables, no-output types', () => {
      const findings = collectDanglingBlockOutputReferences(
        graph({
          start: {
            type: 'start_trigger',
            name: 'Start',
            subBlocks: { inputFormat: { value: [{ name: 'customerId', type: 'string' }] } },
          },
          loop1: { type: 'loop', name: 'Batch' },
          par1: { type: 'parallel', name: 'Fanout' },
          tbl: { type: 'table', name: 'Leads' },
          hook: { type: 'slack', name: 'Notify', triggerMode: true },
          plain: { type: 'slack', name: 'Post' },
          consumer: {
            type: 'api',
            name: 'Call',
            subBlocks: {
              body: {
                value:
                  '<start.customerId> <start.anything> <batch.results> <fanout.results> <leads.row> <notify.payload> <post.whatever>',
              },
            },
          },
        })
      )
      expect(findings).toHaveLength(0)
    })
  })
})
