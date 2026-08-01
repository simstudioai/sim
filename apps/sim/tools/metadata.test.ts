/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getToolIds, getToolMetadata, getToolParams, hasToolMetadata } from '@/tools/metadata'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'

/**
 * Guards the properties the generated artifacts are relied on for. The
 * `tool-metadata:check` script guards that they are in sync with the registry;
 * these guard that what they contain is usable.
 */
describe('generated tool metadata', () => {
  it('covers the whole registry', () => {
    expect(getToolIds().length).toBeGreaterThan(4000)
  })

  it('resolves a known tool with its params', () => {
    const gmail = getToolMetadata('gmail_send')
    expect(gmail?.id).toBe('gmail_send')
    expect(Object.keys(gmail?.params ?? {})).toContain('to')
  })

  it('reports unknown tools as absent without throwing', () => {
    expect(hasToolMetadata('definitely_not_a_tool')).toBe(false)
    expect(getToolMetadata('definitely_not_a_tool')).toBeUndefined()
    expect(getToolParams('definitely_not_a_tool')).toBeUndefined()
    expect(getToolOutputsMetadata('definitely_not_a_tool')).toBeUndefined()
  })

  it('resolves declared outputs for a known tool', () => {
    expect(getToolOutputsMetadata('gmail_send')).toBeDefined()
  })

  /**
   * `JSON.parse` yields an object with the normal prototype, so a bare bracket
   * lookup returns inherited members — `getToolMetadata('constructor')` handed
   * back a function typed as tool metadata.
   */
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'treats inherited key %s as an unknown tool',
    (key) => {
      expect(getToolMetadata(key)).toBeUndefined()
      expect(getToolParams(key)).toBeUndefined()
      expect(getToolOutputsMetadata(key)).toBeUndefined()
      expect(hasToolMetadata(key)).toBe(false)
    }
  )

  /**
   * The registry contains a null param entry (`stt_deepgram_v2`), which crashes
   * any consumer that iterates params unguarded. The generator strips those, so
   * consumers may iterate freely.
   */
  it('contains no null param entries', () => {
    for (const id of getToolIds()) {
      for (const [paramId, config] of Object.entries(getToolParams(id) ?? {})) {
        expect(config, `${id}.${paramId} is empty`).not.toBeNull()
        expect(config, `${id}.${paramId} is empty`).toBeDefined()
      }
    }
  })

  /**
   * The whole point of the artifacts: they carry no executable config, so
   * importing them cannot pull the tool implementations into a module graph.
   */
  it('contains no function values', () => {
    for (const id of getToolIds()) {
      const metadata = getToolMetadata(id)
      for (const [key, value] of Object.entries(metadata ?? {})) {
        expect(typeof value, `${id}.${key} is a function`).not.toBe('function')
      }
      for (const [paramId, config] of Object.entries(metadata?.params ?? {})) {
        for (const [key, value] of Object.entries(config ?? {})) {
          expect(typeof value, `${id}.params.${paramId}.${key} is a function`).not.toBe('function')
        }
      }
    }
  })
})
