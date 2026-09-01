/**
 * @vitest-environment node
 *
 * These helpers read the generated successor map rather than the block
 * registry, so every id below is a real one and the assertions are about the
 * repository's actual lifecycle facts: `slack` was replaced by `slack_v2`,
 * `notion` by `notion_v2`, `file` by `file_v5`.
 */
import { describe, expect, it } from 'vitest'
import {
  intersectAccessControlAllowlists,
  intersectIntegrationAllowlists,
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'

describe('resolveAccessControlBlockType', () => {
  it('judges a superseded block as its successor', () => {
    expect(resolveAccessControlBlockType('slack')).toBe('slack_v2')
  })

  /** The map is flattened, so a chain costs one lookup and never a partial hop. */
  it('answers the terminal version of a chain, not an intermediate one', () => {
    expect(resolveAccessControlBlockType('file')).toBe('file_v5')
    expect(resolveAccessControlBlockType('file_v3')).toBe('file_v5')
  })

  it('leaves a current block alone', () => {
    expect(resolveAccessControlBlockType('slack_v2')).toBe('slack_v2')
  })

  /**
   * A retired block with no successor keeps its own identity, which is the only
   * id an admin can permit it under.
   */
  it('keeps its own identity when nothing replaced it', () => {
    expect(resolveAccessControlBlockType('thinking')).toBe('thinking')
  })

  it('accepts the dashed spelling the registry also normalizes', () => {
    expect(resolveAccessControlBlockType('google-sheets')).toBe('google_sheets_v2')
  })
})

describe('toAccessControlAllowlist', () => {
  it('keeps an unrestricted allowlist unrestricted', () => {
    expect(toAccessControlAllowlist(null)).toBeNull()
  })

  /**
   * `ALLOWED_INTEGRATIONS` is written by hand against whatever ids its author
   * knows, so a deployment that permitted `slack` must not refuse `slack_v2`.
   */
  it('judges a policy entry naming a retired id as its successor', () => {
    const allowlist = toAccessControlAllowlist(['Slack'])

    expect(allowlist?.has('slack_v2')).toBe(true)
    expect(allowlist?.has('slack')).toBe(false)
  })

  it('denies everything for an empty allowlist', () => {
    expect(toAccessControlAllowlist([])?.size).toBe(0)
  })
})

describe('intersectAccessControlAllowlists', () => {
  /**
   * The two policies are written independently — `ALLOWED_INTEGRATIONS` by hand
   * against whatever ids its author knew, the group through an editor that only
   * offers current ones — so they routinely name the same integration by
   * different vintages. Intersecting before resolving leaves those disjoint,
   * which refuses an integration both policies allow.
   */
  it('intersects a retired id against its successor', () => {
    expect([...(intersectAccessControlAllowlists(['slack'], ['slack_v2']) ?? [])]).toEqual([
      'slack_v2',
    ])
    expect([...(intersectAccessControlAllowlists(['slack_v2'], ['slack']) ?? [])]).toEqual([
      'slack_v2',
    ])
  })

  it('keeps either side null as unrestricted', () => {
    expect([...(intersectAccessControlAllowlists(null, ['notion']) ?? [])]).toEqual(['notion_v2'])
    expect([...(intersectAccessControlAllowlists(['notion'], null) ?? [])]).toEqual(['notion_v2'])
    expect(intersectAccessControlAllowlists(null, null)).toBeNull()
  })

  it('keeps an empty policy denying everything', () => {
    expect(intersectAccessControlAllowlists([], ['notion'])?.size).toBe(0)
  })

  it('drops an integration only one policy names', () => {
    expect([...(intersectAccessControlAllowlists(['notion', 'gmail'], ['gmail']) ?? [])]).toEqual([
      'gmail_v2',
    ])
  })
})

describe('intersectIntegrationAllowlists', () => {
  it('uses the configured list when the other policy is unrestricted', () => {
    expect(intersectIntegrationAllowlists(null, ['Slack'])).toEqual(['slack_v2'])
    expect(intersectIntegrationAllowlists(['Notion'], null)).toEqual(['notion_v2'])
    expect(intersectIntegrationAllowlists(null, null)).toBeNull()
  })

  /**
   * The list form must canonicalize identically to the set form, or the config
   * the catalogs carry and the gate the block path applies would disagree about
   * the same two policies.
   */
  it('keeps a mixed-vintage integration both policies allow', () => {
    expect(intersectIntegrationAllowlists(['slack'], ['slack_v2'])).toEqual(['slack_v2'])
  })

  it('keeps only integrations allowed by both policies', () => {
    expect(intersectIntegrationAllowlists(['Slack', 'Notion'], ['notion', 'gmail'])).toEqual([
      'notion_v2',
    ])
  })

  it('preserves an explicit deny-all list', () => {
    expect(intersectIntegrationAllowlists([], null)).toEqual([])
    expect(intersectIntegrationAllowlists(['slack'], [])).toEqual([])
  })
})
