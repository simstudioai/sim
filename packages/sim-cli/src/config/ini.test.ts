import { describe, expect, it } from 'vitest'
import {
  getSection,
  listSections,
  parseIni,
  removeSection,
  serializeIni,
  setSectionValues,
} from './ini'

const SAMPLE = `# top-level note
[default]
endpoint = https://sim.ai
workspace = ws_1

[profile dev]
# points at the local stack
endpoint = http://localhost:3000
`

describe('ini', () => {
  it('reads keys out of a section', () => {
    expect(getSection(parseIni(SAMPLE), 'default')).toEqual({
      endpoint: 'https://sim.ai',
      workspace: 'ws_1',
    })
  })

  it('reads a section whose name contains a space', () => {
    expect(getSection(parseIni(SAMPLE), 'profile dev')).toEqual({
      endpoint: 'http://localhost:3000',
    })
  })

  it('returns null for a section that is not there', () => {
    expect(getSection(parseIni(SAMPLE), 'profile nope')).toBeNull()
  })

  it('lists sections in file order', () => {
    expect(listSections(parseIni(SAMPLE))).toEqual(['default', 'profile dev'])
  })

  it('preserves comments and untouched keys through a write', () => {
    const doc = parseIni(SAMPLE)
    setSectionValues(doc, 'profile dev', { workspace: 'ws_local' })
    const out = serializeIni(doc)

    expect(out).toContain('# top-level note')
    expect(out).toContain('# points at the local stack')
    expect(out).toContain('endpoint = http://localhost:3000')
    expect(out).toContain('workspace = ws_local')
  })

  it('updates a key in place rather than appending a duplicate', () => {
    const doc = parseIni(SAMPLE)
    setSectionValues(doc, 'default', { endpoint: 'https://staging.sim.ai' })
    const out = serializeIni(doc)

    expect(out).not.toContain('https://sim.ai\n')
    expect(out.match(/endpoint = /g)).toHaveLength(2) // one per section, not three
  })

  it('removes a key when the value is null', () => {
    const doc = parseIni(SAMPLE)
    setSectionValues(doc, 'default', { workspace: null })
    expect(getSection(parseIni(serializeIni(doc)), 'default')).toEqual({
      endpoint: 'https://sim.ai',
    })
  })

  it('creates a section that does not exist yet', () => {
    const doc = parseIni(SAMPLE)
    setSectionValues(doc, 'profile prod', { endpoint: 'https://sim.ai' })
    expect(getSection(parseIni(serializeIni(doc)), 'profile prod')).toEqual({
      endpoint: 'https://sim.ai',
    })
  })

  it('does not accumulate blank lines across repeated writes', () => {
    let text = SAMPLE
    for (let i = 0; i < 5; i++) {
      const doc = parseIni(text)
      setSectionValues(doc, 'default', { workspace: `ws_${i}` })
      text = serializeIni(doc)
    }
    expect(text).not.toContain('\n\n\n')
  })

  it('keeps a comment containing "=" as a comment', () => {
    const doc = parseIni('[default]\n# note: a = b\nendpoint = https://sim.ai\n')
    expect(getSection(doc, 'default')).toEqual({ endpoint: 'https://sim.ai' })
    expect(serializeIni(doc)).toContain('# note: a = b')
  })

  it('removes a whole section', () => {
    const doc = parseIni(SAMPLE)
    expect(removeSection(doc, 'profile dev')).toBe(true)
    expect(removeSection(doc, 'profile dev')).toBe(false)
    expect(listSections(doc)).toEqual(['default'])
  })

  it('round-trips an empty document without emitting a stray newline', () => {
    expect(serializeIni(parseIni(''))).toBe('')
  })

  it('merges duplicate sections instead of dropping the later block', () => {
    const doc = parseIni('[default]\nendpoint = https://sim.ai\n\n[default]\nworkspace = ws_2\n')
    expect(getSection(doc, 'default')).toEqual({
      endpoint: 'https://sim.ai',
      workspace: 'ws_2',
    })
  })

  it('resolves a duplicated key the same way a write targets it', () => {
    // `setSectionValues` upserts into the first block, so a first-wins read is
    // what makes the value it wrote the value that comes back.
    const doc = parseIni('[default]\nendpoint = https://first.example\n[default]\nendpoint = x\n')
    expect(getSection(doc, 'default')).toEqual({ endpoint: 'https://first.example' })

    setSectionValues(doc, 'default', { endpoint: 'https://written.example' })
    expect(getSection(parseIni(serializeIni(doc)), 'default')).toEqual({
      endpoint: 'https://written.example',
    })
  })

  /**
   * A merged read makes a later duplicate the active value once the first copy
   * is gone, so clearing only the first block reported an unset that did not
   * happen.
   */
  it('unsets a key in every block that repeats the section', () => {
    const doc = parseIni('[default]\nendpoint = https://first.example\n[default]\nendpoint = x\n')

    setSectionValues(doc, 'default', { endpoint: null })

    expect(getSection(parseIni(serializeIni(doc)), 'default')).toEqual({})
  })

  /** Same reasoning for a whole profile: `sim logout` has to leave none of it. */
  it('removes every block that repeats the section name', () => {
    const doc = parseIni('[profile dev]\napi_key = a\n[profile dev]\napi_key = b\n')

    expect(removeSection(doc, 'profile dev')).toBe(true)

    expect(getSection(doc, 'profile dev')).toBe(null)
    expect(listSections(doc)).toEqual([])
  })

  it('does not open a gap inside the last section across repeated writes', () => {
    let text = SAMPLE
    for (const [key, value] of [
      ['workspace', 'ws_local'],
      ['output', 'json'],
      ['endpoint', 'http://localhost:4000'],
    ]) {
      const doc = parseIni(text)
      setSectionValues(doc, 'profile dev', { [key]: value })
      text = serializeIni(doc)
    }

    expect(text).toBe(
      `# top-level note

[default]
endpoint = https://sim.ai
workspace = ws_1

[profile dev]
# points at the local stack
endpoint = http://localhost:4000
workspace = ws_local
output = json
`
    )
  })
})

/**
 * The format has no escape syntax, so anything that can end a line is structure
 * rather than data. These pin the refusal at the writer — the single place
 * untrusted text enters the document.
 */
describe('ini write guards', () => {
  const INJECTIONS = [
    'ws_1\nendpoint = http://elsewhere.invalid',
    'ws_1\r\nendpoint = http://elsewhere.invalid',
    'ws_1\u2028endpoint = http://elsewhere.invalid',
    'ws_1\u2029endpoint = http://elsewhere.invalid',
  ]

  it('refuses a value that would be read back as a second setting', () => {
    for (const value of INJECTIONS) {
      const doc = parseIni(SAMPLE)
      expect(() => setSectionValues(doc, 'default', { workspace: value })).toThrow(
        /Refusing to write a value/
      )
    }
  })

  it('refuses a section name that would forge another section header', () => {
    const doc = parseIni(SAMPLE)
    expect(() =>
      setSectionValues(doc, 'profile evil]\n[default', { workspace: 'ws_evil' })
    ).toThrow(/Refusing to write a section/)
    expect(() => setSectionValues(doc, 'profile evil]', { workspace: 'ws_evil' })).toThrow(
      /Refusing to write a section/
    )
  })

  /**
   * The assertion that matters: whatever is written, reading the file back
   * cannot produce a section or a setting nobody asked for.
   */
  it('cannot forge a section or a setting through a write-then-read cycle', () => {
    for (const payload of [...INJECTIONS, 'ws]\n[default]\nendpoint = http://elsewhere.invalid']) {
      const doc = parseIni(SAMPLE)
      expect(() => setSectionValues(doc, `profile ${payload}`, { workspace: 'ws' })).toThrow()
      expect(() => setSectionValues(doc, 'profile dev', { workspace: payload })).toThrow()

      const reread = parseIni(serializeIni(doc))
      expect(listSections(reread)).toEqual(['default', 'profile dev'])
      expect(getSection(reread, 'default')).toEqual({
        endpoint: 'https://sim.ai',
        workspace: 'ws_1',
      })
      expect(getSection(reread, 'profile dev')).toEqual({ endpoint: 'http://localhost:3000' })
    }
  })

  /**
   * A whitespace-only value reads back as the empty string, so the key would
   * look stored while resolving as unset.
   */
  it('refuses a blank value', () => {
    const doc = parseIni(SAMPLE)
    expect(() => setSectionValues(doc, 'default', { workspace: '   ' })).toThrow(/blank value/)
  })

  /**
   * The reader trims a section name and a value, so padded text would be stored
   * as one thing and read back as another: the read reports it missing, and the
   * next write appends a second block or key rather than updating the first.
   */
  it.each([' profile dev', 'profile dev ', '  profile dev  '])(
    'refuses the padded section name %j',
    (name) => {
      const doc = parseIni(SAMPLE)
      expect(() => setSectionValues(doc, name, { workspace: 'ws_1' })).toThrow(
        /Refusing to write a section/
      )
    }
  )

  it.each([' ws_1', 'ws_1 ', '  ws_1  '])('refuses the padded value %j', (value) => {
    const doc = parseIni(SAMPLE)
    expect(() => setSectionValues(doc, 'default', { workspace: value })).toThrow(
      /Refusing to write a value/
    )
  })

  it('leaves a legitimate value untouched', () => {
    const doc = parseIni(SAMPLE)
    setSectionValues(doc, 'profile staging-1.eu', { endpoint: 'https://staging.example' })
    expect(getSection(parseIni(serializeIni(doc)), 'profile staging-1.eu')).toEqual({
      endpoint: 'https://staging.example',
    })
  })

  /**
   * `listProfiles` counts section names, so a section conjured by a removal made
   * an unknown profile pass the "does this profile exist?" check for good.
   */
  it('does not create a section for a removal-only update', () => {
    const doc = parseIni('')
    setSectionValues(doc, 'profile fresh', { workspace: null })
    expect(listSections(doc)).toEqual([])
    expect(serializeIni(doc)).toBe('')
  })
})

/**
 * A write names one section, so it must leave every other section's bytes
 * alone. The header was the exception: `parseIni` trims the bracketed text to
 * get the name and the writer rebuilt `[${name}]` from it, so a `configure
 * --set-output` on `default` silently reformatted a hand-written
 * `[profile   padded   ]` it had never been asked to touch.
 */
describe('section headers survive a write to another section', () => {
  it('re-emits an unrelated padded header byte for byte', () => {
    const doc = parseIni(
      '[default]\nendpoint = https://sim.ai\n\n[profile   padded   ]\nworkspace = ws_1\n'
    )

    setSectionValues(doc, 'default', { output: 'json' })

    expect(serializeIni(doc)).toContain('[profile   padded   ]')
  })

  it('generates a header for a section the writer created', () => {
    const doc = parseIni('[default]\nendpoint = https://sim.ai\n')

    setSectionValues(doc, 'profile dev', { workspace: 'ws_2' })

    expect(serializeIni(doc)).toContain('[profile dev]')
  })
})
