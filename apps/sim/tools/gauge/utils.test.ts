import { describe, expect, it } from 'vitest'
import { gaugeCreatePromptsTool } from '@/tools/gauge/create_prompts'
import { buildGaugeUrl, parseGaugeJson, parseGaugeStringArray } from '@/tools/gauge/utils'

describe('Gauge request encoding', () => {
  it('preserves each array filter as a separate encoded query value', () => {
    const url = new URL(
      buildGaugeUrl('/orgs/example/query/metadata', {
        model: ['gpt-4.1', 'a&topic=other'],
        dryRun: false,
        limit: 0,
        cursor: undefined,
      })
    )
    expect(url.searchParams.getAll('model')).toEqual(['gpt-4.1', 'a&topic=other'])
    expect(url.searchParams.has('topic')).toBe(false)
    expect(url.searchParams.get('dryRun')).toBe('false')
    expect(url.searchParams.get('limit')).toBe('0')
    expect(url.searchParams.has('cursor')).toBe(false)
  })

  it('preserves explicit JSON null while omitting blank optional JSON', () => {
    expect(parseGaugeJson('null', 'filters')).toBeNull()
    expect(parseGaugeJson(null, 'filters')).toBeNull()
    expect(parseGaugeJson('  ', 'filters')).toBeUndefined()
    expect(() => parseGaugeJson('{broken', 'filters')).toThrow('filters must be valid JSON')
  })

  it('rejects scalar and mixed-type array inputs before constructing provider requests', () => {
    expect(() => parseGaugeStringArray('"one"', 'tag')).toThrow()
    expect(() => parseGaugeStringArray('["one", 2]', 'tag')).toThrow()
    expect(parseGaugeStringArray('["one", "two"]', 'tag')).toEqual(['one', 'two'])
    expect(() => parseGaugeStringArray([], 'ids', { min: 1, max: 500 })).toThrow()
    expect(() => parseGaugeStringArray(['a', 'b'], 'tagIds', { max: 1 })).toThrow()
  })

  it.each(['', '  '])('rejects a blank identifier %j instead of sending it to Gauge', (value) => {
    expect(() => parseGaugeStringArray([value], 'ids', { min: 1 })).toThrow()
    expect(parseGaugeStringArray([' padded-but-nonblank '], 'ids')).toEqual([
      ' padded-but-nonblank ',
    ])
  })
})

const modelInput = gaugeCreatePromptsTool.request.modelInput
const body = gaugeCreatePromptsTool.request.body
if (!modelInput || modelInput.mode !== 'project' || !modelInput.applyProjected || !body) {
  throw new Error('Gauge prompt request formatting is unavailable')
}
const { select, applyProjected } = modelInput
const requestParams = { accessToken: 'gauge_sk_example', org: 'example', category: 'example' }

describe('Gauge tracked prompt model input', () => {
  const prompts = [
    {
      text: 'Which analytics tool works with token-value?',
      topicId: 'top_example',
      tagIds: ['tag_example'],
      trackingType: 'visibility' as const,
    },
    { text: 'Compare analytics tools', topicId: 'top_other' },
  ]

  it.each([
    ['surrogate pairs', '😀'.repeat(500)],
    ['mixed Unicode and ASCII', `${'😀'.repeat(250)}${'a'.repeat(250)}`],
  ])('accepts 500 code points containing %s without changing the text', (_label, text) => {
    expect(body({ ...requestParams, prompts: [{ text, topicId: 'top_example' }] })).toMatchObject({
      prompts: [{ text, topicId: 'top_example' }],
    })
  })

  it.each([
    ['mixed Unicode and ASCII', `${'😀'.repeat(251)}${'a'.repeat(250)}`],
    ['ASCII', 'a'.repeat(501)],
    ['surrogate pairs', '😀'.repeat(501)],
  ])('rejects 501 code points containing %s', (_label, text) => {
    expect(() => body({ ...requestParams, prompts: [{ text, topicId: 'top_example' }] })).toThrow(
      'Each prompt must have text (1 to 500 characters) and a topicId'
    )
  })

  it('selects prompt text and preserves control fields when rebuilding projected JSON', () => {
    const original = JSON.stringify(prompts)
    expect(select({ ...requestParams, prompts: original })).toEqual({
      prompts: ['Which analytics tool works with token-value?', 'Compare analytics tools'],
    })
    const rebuilt = applyProjected(
      { prompts: original },
      { prompts: ['Which analytics tool works with {{TOKEN}}?', 'Compare analytics tools'] }
    ).prompts
    expect(typeof rebuilt).toBe('string')
    expect(body({ ...requestParams, prompts: rebuilt })).toEqual({
      prompts: [{ ...prompts[0], text: 'Which analytics tool works with {{TOKEN}}?' }, prompts[1]],
    })
    expect(select({ ...requestParams, prompts: rebuilt })).toEqual({
      prompts: ['Which analytics tool works with {{TOKEN}}?', 'Compare analytics tools'],
    })
    expect(prompts[0].text).toContain('token-value')
  })

  it('preserves array input shape and rejects mismatched projections', () => {
    const rebuilt = applyProjected(
      { prompts },
      { prompts: ['{{TOKEN}}', 'Compare analytics tools'] }
    ).prompts
    expect(Array.isArray(rebuilt)).toBe(true)
    expect(body({ ...requestParams, prompts: rebuilt })).toEqual({
      prompts: [{ ...prompts[0], text: '{{TOKEN}}' }, prompts[1]],
    })
    expect(() => applyProjected({ prompts }, { prompts: ['only one'] })).toThrow()
    expect(() =>
      applyProjected({ prompts }, { prompts: [123, 'Compare analytics tools'] })
    ).toThrow()
  })

  it.each([
    '{broken',
    'null',
    '{}',
    '[]',
    '[{"text":"hello"}]',
    '[{"text":10,"topicId":"top_example"}]',
    '[{"text":"hello","topicId":"top_example","tagIds":[5]}]',
  ])('rejects malformed prompt batches: %s', (input) => {
    expect(() => body({ ...requestParams, prompts: input })).toThrow()
  })

  it('rejects batches beyond the documented provider cap', () => {
    expect(() =>
      body({ ...requestParams, prompts: Array.from({ length: 501 }, () => prompts[0]) })
    ).toThrow()
  })
})
