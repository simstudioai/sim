import { describe, expect, it } from 'vitest'
import { getSection, listSections, parseIni, serializeIni, setSectionValues } from './ini'

const SAMPLE = `# top-level note
[default]
endpoint = https://sim.ai
workspace = ws_1

[profile dev]
# points at the local stack
endpoint = http://localhost:3000
`

describe('ini', () => {
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
})
