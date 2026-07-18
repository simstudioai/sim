/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertYamlWithinLimits,
  parseYAMLBuffer,
  YamlComplexityError,
} from '@/lib/file-parsers/yaml-parser'

/**
 * Build a chained alias-expansion ("billion laughs") YAML bomb: each level is
 * an array that references the previous level `width` times, so the expanded
 * node count grows as `width ^ levels` while the source stays tiny.
 */
function buildAliasBomb(levels: number, width: number): string {
  const lines: string[] = [`l0: &l0 [${Array(width).fill('"x"').join(',')}]`]
  for (let i = 1; i <= levels; i++) {
    const refs = Array(width)
      .fill(`*l${i - 1}`)
      .join(',')
    lines.push(`l${i}: &l${i} [${refs}]`)
  }
  lines.push(`root: [${Array(width).fill(`*l${levels}`).join(',')}]`)
  return lines.join('\n')
}

describe('parseYAMLBuffer', () => {
  it('parses a normal YAML document', async () => {
    const result = await parseYAMLBuffer(
      Buffer.from('name: sim\nlist:\n  - a\n  - b\nnested:\n  key: value\n')
    )
    const parsed = JSON.parse(result.content)
    expect(parsed).toEqual({ name: 'sim', list: ['a', 'b'], nested: { key: 'value' } })
    expect(result.metadata.type).toBe('yaml')
    expect(result.metadata.keys).toEqual(['name', 'list', 'nested'])
    expect(result.metadata.depth).toBeGreaterThan(0)
  })

  it('reports depth and array metadata', async () => {
    const result = await parseYAMLBuffer(Buffer.from('- 1\n- 2\n- 3\n'))
    expect(result.metadata.isArray).toBe(true)
    expect(result.metadata.itemCount).toBe(3)
    expect(result.metadata.depth).toBe(1)
  })

  it('rejects an alias-expansion bomb before serialization', async () => {
    const bomb = buildAliasBomb(9, 10)
    expect(Buffer.byteLength(bomb)).toBeLessThan(2048)
    await expect(parseYAMLBuffer(Buffer.from(bomb))).rejects.toBeInstanceOf(YamlComplexityError)
  })

  it('rejects a key-amplification bomb (aliased object with a long key)', async () => {
    const longKey = 'k'.repeat(2000)
    const lines: string[] = [`l0: &l0 {${longKey}: 1}`]
    for (let i = 1; i <= 8; i++) {
      lines.push(
        `l${i}: &l${i} [${Array(10)
          .fill(`*l${i - 1}`)
          .join(',')}]`
      )
    }
    lines.push(`root: [${Array(10).fill('*l8').join(',')}]`)
    const bomb = lines.join('\n')
    expect(Buffer.byteLength(bomb)).toBeLessThan(4096)
    await expect(parseYAMLBuffer(Buffer.from(bomb))).rejects.toBeInstanceOf(YamlComplexityError)
  })

  it('surfaces malformed YAML as an Invalid YAML error', async () => {
    await expect(parseYAMLBuffer(Buffer.from('key: "unterminated\n'))).rejects.toThrow(
      /Invalid YAML/
    )
  })
})

describe('assertYamlWithinLimits', () => {
  it('returns the depth of a well-formed structure', () => {
    expect(assertYamlWithinLimits({ a: { b: { c: 1 } } })).toBe(3)
    expect(assertYamlWithinLimits([1, 2, 3])).toBe(1)
    expect(assertYamlWithinLimits('scalar')).toBe(0)
  })

  it('rejects nesting beyond the depth cap', () => {
    let deep: unknown = 1
    for (let i = 0; i < 600; i++) deep = { a: deep }
    expect(() => assertYamlWithinLimits(deep)).toThrow(YamlComplexityError)
  })

  it('rejects a cyclic structure via the node cap', () => {
    const node: Record<string, unknown> = {}
    node.self = node
    expect(() => assertYamlWithinLimits(node)).toThrow(YamlComplexityError)
  })

  it('charges object keys, not just values', () => {
    const hugeKey = 'k'.repeat(70 * 1024 * 1024)
    expect(() => assertYamlWithinLimits({ [hugeKey]: 1 })).toThrow(YamlComplexityError)
  })

  it('rejects a large plain-text value only when it truly exceeds the size cap', () => {
    // ~10 MB of plain ASCII serializes ~1:1 and must be accepted (no false positive).
    expect(() => assertYamlWithinLimits({ text: 'a'.repeat(10 * 1024 * 1024) })).not.toThrow()
    // ~70 MB exceeds the 64 MB cap and must be rejected.
    expect(() => assertYamlWithinLimits({ text: 'a'.repeat(70 * 1024 * 1024) })).toThrow(
      YamlComplexityError
    )
  })

  it('charges the true escaped length of escape-heavy strings', () => {
    // ~11M control chars each serialize to a six-char \uXXXX escape (~66 MB > 64 MB).
    const escapeHeavy = ''.repeat(11 * 1024 * 1024)
    expect(() => assertYamlWithinLimits({ text: escapeHeavy })).toThrow(YamlComplexityError)
    expect(escapeHeavy.length).toBeLessThan(64 * 1024 * 1024)
  })

  it('charges lone surrogates at their escaped length', () => {
    // JSON.stringify escapes a lone surrogate to \uXXXX (six units). ~11M of
    // them estimate to ~66 MB (> 64 MB) though the raw length is under the cap.
    const loneSurrogates = String.fromCharCode(0xd800).repeat(11 * 1024 * 1024)
    expect(loneSurrogates.length).toBeLessThan(64 * 1024 * 1024)
    expect(() => assertYamlWithinLimits({ text: loneSurrogates })).toThrow(YamlComplexityError)
    // A valid surrogate pair (astral char) is emitted as-is, so ~10M of them
    // (~20M code units, ~20 MB) stays well under the cap.
    const astral = String.fromCodePoint(0x1f600).repeat(10 * 1024 * 1024)
    expect(() => assertYamlWithinLimits({ text: astral })).not.toThrow()
  })
})
