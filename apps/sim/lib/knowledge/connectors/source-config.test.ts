/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  preserveServerOwnedSourceConfig,
  RESERVED_SOURCE_CONFIG_KEYS,
  sanitizeConnectorSourceConfig,
} from '@/lib/knowledge/connectors/source-config'

describe('sanitizeConnectorSourceConfig', () => {
  /**
   * The tenancy control for `sim`-mode connectors: the engine derives the workspace
   * from the knowledge_base row, so a caller-supplied one must never be persisted
   * where a connector could read it back.
   */
  it('strips every reserved key a caller could use to widen scope', () => {
    expect(
      sanitizeConnectorSourceConfig({
        workspaceId: 'victim-ws',
        knowledgeBaseId: 'victim-kb',
        tagSlotMapping: { folderPath: 'tag7' },
        folderId: 'f-1',
        recursive: 'false',
      })
    ).toEqual({ folderId: 'f-1', recursive: 'false' })
  })

  it('covers the whole declared reserved list', () => {
    const everyReserved = Object.fromEntries(RESERVED_SOURCE_CONFIG_KEYS.map((k) => [k, 'x']))
    expect(sanitizeConnectorSourceConfig(everyReserved)).toEqual({})
  })

  it('leaves unreserved keys untouched, including falsy values', () => {
    const input = { folderId: '', recursive: 'false', maxFiles: 0 }
    expect(sanitizeConnectorSourceConfig(input)).toEqual(input)
  })

  it('does not mutate the caller object', () => {
    const input = { workspaceId: 'victim-ws', folderId: 'f-1' }
    sanitizeConnectorSourceConfig(input)
    expect(input.workspaceId).toBe('victim-ws')
  })
})

describe('preserveServerOwnedSourceConfig', () => {
  /**
   * Update replaces `sourceConfig` wholesale. Without this, sanitizing would drop
   * `tagSlotMapping` on every edit and the connector would silently stop writing
   * tags — for every connector that declares tagDefinitions, not just the sim ones.
   */
  it('carries the stored tagSlotMapping across an edit that does not resend it', () => {
    expect(
      preserveServerOwnedSourceConfig(
        { folderId: 'new-folder' },
        { folderId: 'old-folder', tagSlotMapping: { folderPath: 'tag1' } }
      )
    ).toEqual({ folderId: 'new-folder', tagSlotMapping: { folderPath: 'tag1' } })
  })

  /** The stored mapping wins: a caller cannot claim slots it was not allocated. */
  it('prefers the stored mapping over anything left in the update', () => {
    const result = preserveServerOwnedSourceConfig(
      { tagSlotMapping: { folderPath: 'tag7' } } as Record<string, unknown>,
      { tagSlotMapping: { folderPath: 'tag1' } }
    )
    expect(result.tagSlotMapping).toEqual({ folderPath: 'tag1' })
  })

  /** workspaceId/knowledgeBaseId are never persisted, so nothing should resurrect them. */
  it('does not resurrect keys that are never persisted', () => {
    const result = preserveServerOwnedSourceConfig(
      { folderId: 'f-1' },
      { workspaceId: 'victim-ws', knowledgeBaseId: 'victim-kb' }
    )
    expect(result).toEqual({ folderId: 'f-1' })
  })

  it('tolerates a connector row with no stored config', () => {
    expect(preserveServerOwnedSourceConfig({ folderId: 'f-1' }, null)).toEqual({ folderId: 'f-1' })
    expect(preserveServerOwnedSourceConfig({ folderId: 'f-1' }, undefined)).toEqual({
      folderId: 'f-1',
    })
  })
})
