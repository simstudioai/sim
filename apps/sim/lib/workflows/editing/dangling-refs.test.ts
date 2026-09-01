/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { collectDanglingBlockOutputReferences } from '@/lib/workflows/editing/lint'

function graph(
  blocks: Record<
    string,
    { type?: string; name?: string; subBlocks?: Record<string, { value?: unknown }> }
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

  it('skips function code fields (the runtime fails those loudly)', () => {
    const findings = collectDanglingBlockOutputReferences(
      graph({
        b1: {
          type: 'function',
          name: 'Fn',
          subBlocks: { code: { value: 'return <ghost.value>' } },
        },
      })
    )
    expect(findings).toHaveLength(0)
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
})
