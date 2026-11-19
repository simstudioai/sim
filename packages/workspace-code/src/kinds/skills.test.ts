import fc from 'fast-check'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from '../fingerprint'
import { type SkillDecl, skillCodec } from './skills'

const text = fc.string({ maxLength: 40 }).filter((value) => !/[\u0000\ud800-\udfff]/.test(value))

const skill: fc.Arbitrary<SkillDecl> = fc.record({
  name: fc.oneof(text, fc.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
  description: fc.oneof(
    text,
    fc.constantFrom(
      'Answer: briefly',
      ' padded ',
      'a #tag',
      'true',
      '12',
      '"quoted"',
      'line\nbreak'
    )
  ),
  content: fc.oneof(text, fc.constantFrom('', '\n', '---\nname: x\n---\n', 'body\n---', '\r\n')),
})

function parse(source: string) {
  return skillCodec.parse('tone', { 'skills/tone.md': source }, [])
}

describe('skillCodec', () => {
  it('reads back every skill it prints, byte-stable', () => {
    fc.assert(
      fc.property(skill, (decl) => {
        const printed = skillCodec.print('tone', decl)
        const parsed = skillCodec.parse('tone', printed.text, [])
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        if (parsed.decl) expect(skillCodec.print('tone', parsed.decl)).toEqual(printed)
      }),
      { numRuns: 500 }
    )
  })

  it('prints frontmatter a YAML reader reads as the same strings', () => {
    const scalar = fc.oneof(
      fc.stringOf(fc.constantFrom('0', '1', '9', 'e', 'x', 'F', 'y', 'n', '-', '.', ':', '_', ' ')),
      fc.constantFrom('1e3', '0x1F', '0o17', '2024-01-01', '12:30', 'y', 'N', '.5', '1_000', 'NULL')
    )
    fc.assert(
      fc.property(scalar, scalar, (name, description) => {
        const printed = skillCodec.print('tone', { name, description, content: '' })
        const lines = printed.text['skills/tone.md'].split('\n')
        const frontmatter = lines.slice(1, lines.indexOf('---', 1)).join('\n')
        expect(load(frontmatter)).toEqual({ name, description })
      }),
      { numRuns: 500 }
    )
  })

  it('prints plain values bare and the rest as JSON strings', () => {
    const printed = skillCodec.print('tone', {
      name: 'tone',
      description: 'Voice: short',
      content: 'Be warm.\n',
    })
    expect(printed.text['skills/tone.md']).toBe(
      '---\nname: tone\ndescription: "Voice: short"\n---\nBe warm.\n'
    )
  })

  it('reads a file whose closing fence is its last line as empty content', () => {
    expect(parse('---\nname: tone\ndescription: Short\n---').decl).toEqual({
      name: 'tone',
      description: 'Short',
      content: '',
    })
  })

  it('pins each frontmatter problem to its line', () => {
    const findings = parse(
      '---\nname: tone\ntitle: x\nname: again\ndescription: "unterminated\n---\nBody'
    ).diagnostics
    expect(findings.map((finding) => [finding.code, finding.span?.line])).toEqual([
      ['E_SKILL_FRONTMATTER', 3],
      ['E_SKILL_FRONTMATTER', 4],
      ['E_SKILL_FRONTMATTER', 5],
    ])
    expect(findings[0].message).toContain('only name and description')
  })

  it('refuses a missing fence, a missing field, an unquoted unsafe value, and NUL', () => {
    const first = (source: string) => parse(source).diagnostics.map((finding) => finding.message)
    expect(first('name: tone\n')).toEqual(['The file must start with a `---` line.'])
    expect(first('')).toEqual(['The file must start with a `---` line.'])
    expect(first('---\nname: tone\ndescription: x\n')).toEqual([
      'The frontmatter has no closing `---` line.',
    ])
    expect(first('---\nname: tone\n---\n')).toEqual(['The frontmatter has no description.'])
    expect(first('---\nname: tone\ndescription:  spaced\n---\n')[0]).toContain('Quote')
    expect(first('---\nname: tone\ndescription: x\n---\n\u0000')[0]).toContain('NUL')
  })

  it('fingerprints content stored with CRLF the same after the CLI reads it back as LF', () => {
    const stored: SkillDecl = { name: 'tone', description: 'Tone', content: 'one\r\ntwo\r\n' }
    const printed = skillCodec.print('tone', stored).text['skills/tone.md']
    const parsed = parse(printed.replace(/\r\n/g, '\n'))
    expect(parsed.decl).toBeDefined()
    if (parsed.decl) {
      expect(fingerprintOf(skillCodec.canonical(parsed.decl))).toBe(
        fingerprintOf(skillCodec.canonical(stored))
      )
    }
  })

  it('groups one markdown file per key', () => {
    const grouped = skillCodec.group(['skills/tone.md', 'skills/tone.txt', 'skills/a/b.md'])
    expect([...grouped.groups.keys()]).toEqual(['tone'])
    expect(grouped.diagnostics).toHaveLength(2)
  })
})
