/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { applyPipeline as applyPipelineRaw } from '@/lib/mothership/agent-cli/pipeline'
import type { AgentCliGrepStage, AgentCliPipeStage } from '@/lib/mothership/generated/agent-cli'

async function applyPipeline(stdout: string, stages: AgentCliPipeStage[]): Promise<string> {
  const result = await applyPipelineRaw({ exitCode: 0, stdout, stderr: '' }, stages)
  return result.exitCode === 0 ? result.stdout : `ERROR ${result.stderr}`
}

function grep(overrides: Partial<AgentCliGrepStage> & { pattern: string }): AgentCliGrepStage {
  return {
    kind: 'grep',
    ignoreCase: false,
    invert: false,
    countOnly: false,
    lineNumbers: false,
    linesBefore: 0,
    linesAfter: 0,
    ...overrides,
  }
}

describe('applyPipeline over typed grep stages', () => {
  const input = 'alpha slack\nbeta\ngamma SLACK\nslack delta\n'

  it('filters lines by pattern', async () => {
    expect(await applyPipeline(input, [grep({ pattern: 'slack' })])).toBe(
      'alpha slack\nslack delta'
    )
  })

  it('honours ignoreCase, lineNumbers, invert, countOnly, and maxCount', async () => {
    expect(await applyPipeline(input, [grep({ pattern: 'slack', ignoreCase: true })])).toBe(
      'alpha slack\ngamma SLACK\nslack delta'
    )
    expect(await applyPipeline(input, [grep({ pattern: 'slack', lineNumbers: true })])).toBe(
      '1:alpha slack\n4:slack delta'
    )
    expect(await applyPipeline(input, [grep({ pattern: 'slack', invert: true })])).toBe(
      'beta\ngamma SLACK\n'
    )
    expect(
      await applyPipeline(input, [grep({ pattern: 'slack', ignoreCase: true, countOnly: true })])
    ).toBe('3')
    expect(
      await applyPipeline(input, [grep({ pattern: 'slack', ignoreCase: true, maxCount: 2 })])
    ).toBe('alpha slack\ngamma SLACK')
  })

  it('treats the pattern as a regex with a literal fallback', async () => {
    expect(await applyPipeline('a1\nb2\nc3', [grep({ pattern: '^[ab]' })])).toBe('a1\nb2')
    expect(await applyPipeline('cost is $4 (net', [grep({ pattern: '$4 (net' })])).toBe(
      'cost is $4 (net'
    )
  })

  it('chains stages left to right', async () => {
    expect(
      await applyPipeline(input, [
        grep({ pattern: 'slack', ignoreCase: true }),
        grep({ pattern: 'delta', invert: true }),
      ])
    ).toBe('alpha slack\ngamma SLACK')
  })

  describe('context windows', () => {
    const lines = 'a\nb\nHIT\nc\nd\ne\nHIT\nf'
    it('trailing context', async () => {
      expect(await applyPipeline(lines, [grep({ pattern: 'HIT', linesAfter: 1 })])).toBe(
        'HIT\nc\nHIT\nf'
      )
    })
    it('windows without duplicating overlaps', async () => {
      expect(
        await applyPipeline('x\nHIT\nHIT\ny', [
          grep({ pattern: 'HIT', linesBefore: 1, linesAfter: 1 }),
        ])
      ).toBe('x\nHIT\nHIT\ny')
    })
    it('counts hits, not context lines', async () => {
      expect(
        await applyPipeline(lines, [grep({ pattern: 'HIT', countOnly: true, linesAfter: 2 })])
      ).toBe('2')
    })
  })
})

describe('jq and outline over JSON stdout', () => {
  const json = JSON.stringify({
    data: {
      operations: { send: { toolId: 'slack_send' }, list: { toolId: 'slack_list' } },
      tags: ['a', 'b'],
    },
  })

  it('jq slices with real jq semantics', async () => {
    expect(await applyPipeline(json, [{ kind: 'jq', expression: '.data.operations | keys' }])).toBe(
      '[\n  "list",\n  "send"\n]'
    )
    expect(await applyPipeline(json, [{ kind: 'jq', expression: '.data.tags[]' }])).toBe('"a"\n"b"')
  })

  it('outline reports keys, types, and counts without values', async () => {
    const outline = await applyPipeline(json, [{ kind: 'outline' }])
    expect(outline).toContain('data: object{2}')
    expect(outline).toContain('operations: object{2}')
    expect(outline).toContain('tags: array[2]')
    expect(outline).not.toContain('slack_send')
  })

  it('fails the invocation with the reason when stdout is not JSON or the program is bad', async () => {
    expect(await applyPipeline('plain text', [{ kind: 'jq', expression: '.' }])).toContain(
      'output is text, not JSON'
    )
    expect(await applyPipeline(json, [{ kind: 'jq', expression: '.data |' }])).toContain('jq:')
  })
})
