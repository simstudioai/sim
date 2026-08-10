/**
 * @vitest-environment node
 *
 * Structural invariants across every connector. These are the failure modes that
 * compile cleanly and only surface at runtime — a connector missing from one of the
 * two registries, a selector field whose manual twin drifted, an auth mode the UI
 * cannot render.
 */
import { describe, expect, it } from 'vitest'
import { getSlotsForFieldType } from '@/lib/knowledge/constants'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import { type ConnectorConfigField, collectsCredential } from '@/connectors/types'
import { selectorRegistry } from '@/hooks/selectors/registry'

const metaEntries = Object.entries(CONNECTOR_META_REGISTRY)
const runtimeEntries = Object.entries(CONNECTOR_REGISTRY)

/**
 * Pre-existing connectors that declare more tags of a type than there are slots, so
 * `allocateTagSlots` always drops the ones it cannot place on a fresh knowledge base —
 * silently, with only a server-side warning.
 *
 * - `azure_devops`: 8 text tags against 7 text slots (`path` / "File Path" is lost).
 * - `google_calendar`: 3 date tags against 2 date slots.
 *
 * Every tag involved is genuinely populated by its connector's `mapTags`, so choosing
 * which to cut is a product decision about that service's semantics rather than a
 * mechanical fix, and is left to each connector's owner. Ratcheted rather than
 * relaxed so the invariant still holds for every other connector.
 */
const OVERSUBSCRIBED_TAG_CONNECTORS = new Set(['azure_devops', 'google_calendar'])

describe('connector registries', () => {
  /** A connector present in only one registry breaks either the picker or the sync. */
  it('registers every connector in both the client and server registries', () => {
    expect(Object.keys(CONNECTOR_REGISTRY).sort()).toEqual(
      Object.keys(CONNECTOR_META_REGISTRY).sort()
    )
  })

  it('keys every connector by its own id', () => {
    for (const [key, meta] of metaEntries) {
      expect(meta.id, `${key} registry key must match meta.id`).toBe(key)
    }
  })

  it('keeps both registries alphabetically ordered', () => {
    const metaKeys = Object.keys(CONNECTOR_META_REGISTRY)
    const runtimeKeys = Object.keys(CONNECTOR_REGISTRY)
    expect(metaKeys).toEqual([...metaKeys].sort())
    expect(runtimeKeys).toEqual([...runtimeKeys].sort())
  })
})

describe('connector config fields', () => {
  /**
   * The add-connector modal persists a canonical pair under its `canonicalParamId`,
   * choosing whichever member matches the active mode. A selector without its manual
   * twin leaves the advanced toggle with nothing to switch to; mismatched `required`
   * lets a field be mandatory in one mode and optional in the other.
   */
  it('pairs every selector field with a manual twin of matching requiredness', () => {
    for (const [key, meta] of metaEntries) {
      const selectors = meta.configFields.filter(
        (field): field is ConnectorConfigField => field.type === 'selector'
      )

      for (const selector of selectors) {
        expect(
          selector.canonicalParamId,
          `${key}.${selector.id} needs a canonicalParamId`
        ).toBeTruthy()
        expect(selector.mode, `${key}.${selector.id} must declare a mode`).toBe('basic')

        const twins = meta.configFields.filter(
          (field) =>
            field.canonicalParamId === selector.canonicalParamId && field.id !== selector.id
        )

        expect(twins, `${key}.${selector.id} must have exactly one manual twin`).toHaveLength(1)
        expect(twins[0].mode, `${key}.${twins[0].id} must be the advanced twin`).toBe('advanced')
        expect(
          Boolean(twins[0].required),
          `${key}.${twins[0].id} requiredness must match its selector`
        ).toBe(Boolean(selector.required))
        expect(Boolean(twins[0].multi), `${key}.${twins[0].id} multi must match its selector`).toBe(
          Boolean(selector.multi)
        )
      }
    }
  })

  /**
   * `getSelectorDefinition` throws on an unknown key, and only when the field renders.
   * Catches a `SelectorKey` union widened without registering the definition.
   */
  it('references only selector keys that exist in the selector registry', () => {
    for (const [key, meta] of metaEntries) {
      for (const field of meta.configFields) {
        if (field.type !== 'selector' || !field.selectorKey) continue
        expect(
          Object.keys(selectorRegistry),
          `${key}.${field.id} references unknown selector ${field.selectorKey}`
        ).toContain(field.selectorKey)
      }
    }
  })

  it('gives every dropdown field options to choose from', () => {
    for (const [key, meta] of metaEntries) {
      for (const field of meta.configFields) {
        if (field.type !== 'dropdown') continue
        expect(field.options?.length, `${key}.${field.id} dropdown needs options`).toBeGreaterThan(
          0
        )
      }
    }
  })
})

describe('connector tag definitions', () => {
  /** Slots are allocated from `mapTags` output, so tags without it are never written. */
  it('implements mapTags wherever tag definitions are declared', () => {
    for (const [key, connector] of runtimeEntries) {
      if (!connector.tagDefinitions?.length) continue
      expect(typeof connector.mapTags, `${key} declares tags but has no mapTags`).toBe('function')
    }
  })

  it('uses unique tag ids and display names per connector', () => {
    for (const [key, meta] of metaEntries) {
      const ids = (meta.tagDefinitions ?? []).map((tag) => tag.id)
      const names = (meta.tagDefinitions ?? []).map((tag) => tag.displayName)
      expect(new Set(ids).size, `${key} has duplicate tag ids`).toBe(ids.length)
      expect(new Set(names).size, `${key} has duplicate tag display names`).toBe(names.length)
    }
  })

  /**
   * Slots per field type are finite (`TAG_SLOT_CONFIG`: 7 text, 5 number, 2 date, 3
   * boolean). A connector declaring more tags of a type than there are slots
   * guarantees at least one is silently dropped — `allocateTagSlots` only logs a
   * warning and 422s when it could place nothing at all.
   *
   * Fitting within the budget is not the same as being a good neighbor: a connector
   * claiming every slot of a type starves any other connector on the same knowledge
   * base. That is a judgment call per connector, so it is not asserted here.
   */
  it('declares no more tags of a type than there are slots for it', () => {
    for (const [key, meta] of metaEntries) {
      if (OVERSUBSCRIBED_TAG_CONNECTORS.has(key)) continue

      const countsByType = new Map<string, number>()
      for (const tag of meta.tagDefinitions ?? []) {
        countsByType.set(tag.fieldType, (countsByType.get(tag.fieldType) ?? 0) + 1)
      }

      for (const [fieldType, count] of countsByType) {
        const capacity = getSlotsForFieldType(fieldType).length
        expect(capacity, `${key} uses unknown tag field type "${fieldType}"`).toBeGreaterThan(0)
        expect(
          count,
          `${key} declares ${count} ${fieldType} tags but only ${capacity} slots exist`
        ).toBeLessThanOrEqual(capacity)
      }
    }
  })

  /** The exemption list must shrink, never grow. */
  it('has no unnecessary entries in the oversubscribed allowlist', () => {
    for (const key of OVERSUBSCRIBED_TAG_CONNECTORS) {
      expect(CONNECTOR_META_REGISTRY[key], `${key} is allowlisted but not registered`).toBeDefined()
    }
    expect(OVERSUBSCRIBED_TAG_CONNECTORS.size).toBeLessThanOrEqual(2)
  })
})

describe('sim-mode connectors', () => {
  const simConnectors = runtimeEntries.filter(([, connector]) => connector.auth.mode === 'sim')

  it('ships the expected native connectors', () => {
    expect(simConnectors.map(([key]) => key).sort()).toEqual(['sim_conversations', 'sim_files'])
  })

  /** The modal renders no auth row for these, so they must not need one. */
  it('collects no credential', () => {
    for (const [key, connector] of simConnectors) {
      expect(collectsCredential(connector.auth), `${key} must not collect a credential`).toBe(false)
    }
  })

  /**
   * Validation runs before any credential exists, with an empty access token. Anything
   * that reached for a token here would throw on connector creation.
   */
  it('validates an empty config without a token', async () => {
    for (const [key, connector] of simConnectors) {
      await expect(
        connector.validateConfig('', {}),
        `${key} must validate without a credential`
      ).resolves.toMatchObject({ valid: true })
    }
  })

  it('rejects malformed numeric config', async () => {
    await expect(
      CONNECTOR_REGISTRY.sim_files.validateConfig('', { maxFiles: 'lots' })
    ).resolves.toMatchObject({ valid: false })
    await expect(
      CONNECTOR_REGISTRY.sim_conversations.validateConfig('', { minMessages: '-1' })
    ).resolves.toMatchObject({ valid: false })
  })
})
