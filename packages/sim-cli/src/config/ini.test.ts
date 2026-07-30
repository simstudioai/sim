import { describe, expect, it } from 'vitest'
import {
  getSection,
  listSections,
  parseIni,
  removeSection,
  serializeIni,
  setSectionValues,
} from './ini.js'

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
})
