/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { applyPipeline, splitPipeline } from '@/lib/mothership/tools/handlers/sim-cli-pipe'

describe('splitPipeline', () => {
  it('returns the argv untouched when no pipe token is present', () => {
    expect(splitPipeline(['workflows', 'list'])).toEqual({
      cliArgs: ['workflows', 'list'],
      stages: [],
    })
  })

  it('splits the invocation from grep stages on | tokens', () => {
    expect(splitPipeline(['workflows', 'export', 'w1', '|', 'grep', '-n', 'slack'])).toEqual({
      cliArgs: ['workflows', 'export', 'w1'],
      stages: [['grep', '-n', 'slack']],
    })
  })

  it('supports chained grep stages', () => {
    expect(
      splitPipeline(['logs', 'list', '|', 'grep', 'error', '|', 'grep', '-v', 'retry'])
    ).toEqual({
      cliArgs: ['logs', 'list'],
      stages: [
        ['grep', 'error'],
        ['grep', '-v', 'retry'],
      ],
    })
  })

  it('yields an empty invocation when the argv starts with a pipe', () => {
    expect(splitPipeline(['|', 'grep', 'x']).cliArgs).toEqual([])
  })
})

describe('applyPipeline', () => {
  const input = 'alpha slack\nbeta\ngamma SLACK\nslack delta\n'

  it('filters lines by pattern', () => {
    const result = applyPipeline(input, [['grep', 'slack']])
    expect(result).toEqual({ ok: true, stdout: 'alpha slack\nslack delta' })
  })

  it('supports -i, -n, -v, -c, and -m', () => {
    expect(applyPipeline(input, [['grep', '-i', 'slack']])).toEqual({
      ok: true,
      stdout: 'alpha slack\ngamma SLACK\nslack delta',
    })
    expect(applyPipeline(input, [['grep', '-n', 'slack']])).toEqual({
      ok: true,
      stdout: '1:alpha slack\n4:slack delta',
    })
    expect(applyPipeline(input, [['grep', '-v', 'slack']])).toEqual({
      ok: true,
      stdout: 'beta\ngamma SLACK\n',
    })
    expect(applyPipeline(input, [['grep', '-c', '-i', 'slack']])).toEqual({
      ok: true,
      stdout: '3',
    })
    expect(applyPipeline(input, [['grep', '-i', '-m', '2', 'slack']])).toEqual({
      ok: true,
      stdout: 'alpha slack\ngamma SLACK',
    })
  })

  it('treats the pattern as a regex with a literal fallback', () => {
    expect(applyPipeline('a1\nb2\nc3', [['grep', '^[ab]']])).toEqual({ ok: true, stdout: 'a1\nb2' })
    expect(applyPipeline('cost is $4 (net', [['grep', '$4 (net']])).toEqual({
      ok: true,
      stdout: 'cost is $4 (net',
    })
  })

  it('chains stages left to right', () => {
    const result = applyPipeline(input, [
      ['grep', '-i', 'slack'],
      ['grep', '-v', 'delta'],
    ])
    expect(result).toEqual({ ok: true, stdout: 'alpha slack\ngamma SLACK' })
  })

  it('rejects non-grep stages with guidance', () => {
    const result = applyPipeline(input, [['jq', '.name']])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('grep is the only pipe target')
  })

  it('rejects unsupported grep flags and missing patterns', () => {
    expect(applyPipeline(input, [['grep', '-o', 'x']]).ok).toBe(false)
    expect(applyPipeline(input, [['grep', '-i']]).ok).toBe(false)
    expect(applyPipeline(input, [['grep', '-m', 'zero', 'x']]).ok).toBe(false)
  })

  it('validates stages against empty input for preflight use', () => {
    expect(applyPipeline('', [['grep', '-n', 'x']]).ok).toBe(true)
    expect(applyPipeline('', [['head', '-n', '5']]).ok).toBe(false)
  })
})

describe('grep context flags', () => {
  const input = 'a\nb\nHIT\nc\nd\ne\nHIT\nf'
  it('-A appends trailing context lines', () => {
    const r = applyPipeline(input, [['grep', '-A', '1', 'HIT']])
    expect(r).toEqual({ ok: true, stdout: 'HIT\nc\nHIT\nf' })
  })
  it('-B and -C select windows without duplicating overlaps', () => {
    const r = applyPipeline('x\nHIT\nHIT\ny', [['grep', '-C', '1', 'HIT']])
    expect(r).toEqual({ ok: true, stdout: 'x\nHIT\nHIT\ny' })
  })
  it('-c counts hits, not context lines', () => {
    const r = applyPipeline(input, [['grep', '-c', '-A', '2', 'HIT']])
    expect(r).toEqual({ ok: true, stdout: '2' })
  })
  it('rejects a negative context count with usage guidance', () => {
    const r = applyPipeline(input, [['grep', '-A', '-2', 'HIT']])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('-A needs a non-negative number')
  })
})
