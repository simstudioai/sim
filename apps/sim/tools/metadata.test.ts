/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getToolMetadata, getToolParams } from '@/tools/metadata'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'
import { getToolIds, hasToolId, resolveToolId } from '@/tools/tool-ids'

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
    expect(hasToolId('definitely_not_a_tool')).toBe(false)
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
      expect(hasToolId(key)).toBe(false)
    }
  )

  /**
   * `getTool` resolves an unversioned name onto the newest version, and callers
   * migrated off it depend on that. A plain key lookup would silently report
   * versioned tools as missing.
   */
  describe('version resolution', () => {
    /**
     * Only a versioned id whose base name is *not* itself registered exercises
     * resolution — where both exist, the base name resolves to itself.
     */
    const versionedId = getToolIds().find(
      (id) => /_v[2-9]\d*$/.test(id) && !getToolIds().includes(id.replace(/_v\d+$/, ''))
    )

    it('has at least one versioned tool to exercise', () => {
      expect(versionedId).toBeDefined()
    })

    it('maps an unversioned name onto the newest version', () => {
      const baseName = (versionedId as string).replace(/_v\d+$/, '')
      expect(getToolIds()).not.toContain(baseName)
      expect(resolveToolId(baseName)).toBe(versionedId)
      expect(hasToolId(baseName)).toBe(true)
      expect(getToolMetadata(baseName)?.id).toBe(getToolMetadata(versionedId as string)?.id)
      expect(getToolOutputsMetadata(baseName)).toEqual(
        getToolOutputsMetadata(versionedId as string)
      )
    })

    it('returns an unknown name unchanged', () => {
      expect(resolveToolId('definitely_not_a_tool')).toBe('definitely_not_a_tool')
    })
  })

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
