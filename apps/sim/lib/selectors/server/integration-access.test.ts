/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { selectorManifest } from '@/lib/selectors/manifest'
import { selectorIntegrationBlockTypes } from '@/lib/selectors/server/integration-access'
import { serverSelectorRegistry } from '@/lib/selectors/server/registry'

describe('selectorIntegrationBlockTypes', () => {
  /**
   * The gate passes a selector with no integration identity, so an identity it
   * cannot derive is a silent hole: `POST /api/selectors/execute` reaches the
   * third party with the caller's credentials and the group's
   * `allowedIntegrations` never gets a say. Every selector the manifest calls
   * `provider-server` must therefore resolve to at least one block type, either
   * through the OAuth credential catalog or by declaring one.
   */
  it('gives every provider selector an integration identity', () => {
    const ungated = Object.entries(serverSelectorRegistry)
      .filter(([key]) => selectorManifest[key as keyof typeof selectorManifest])
      .filter(
        ([key, attachment]) =>
          selectorManifest[key as keyof typeof selectorManifest].classification ===
            'provider-server' && selectorIntegrationBlockTypes(attachment).length === 0
      )
      .map(([key]) => key)

    expect(ungated).toEqual([])
  })

  /**
   * The other half of the same rule: an internal selector reads Sim's own
   * workspace data, so it is not an integration and nothing gates it.
   */
  it('gives an internal selector no integration identity', () => {
    const internal = Object.entries(serverSelectorRegistry).filter(
      ([key]) =>
        selectorManifest[key as keyof typeof selectorManifest]?.classification === 'internal-server'
    )

    expect(internal.length).toBeGreaterThan(0)
    for (const [key, attachment] of internal) {
      expect([key, selectorIntegrationBlockTypes(attachment)]).toEqual([key, []])
    }
  })

  /** A declaration wins over the catalog, which is what an API-key selector needs. */
  it('prefers a declared block type over the credential catalog', () => {
    expect(
      selectorIntegrationBlockTypes({
        credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['gmail'] },
        integrationBlockTypes: ['snowflake'],
      })
    ).toEqual(['snowflake'])
  })

  it('derives the block type from the credential resource when none is declared', () => {
    expect(
      selectorIntegrationBlockTypes({
        credential: {
          kind: 'stored',
          field: 'oauthCredential',
          serviceIds: ['google-drive', 'google-sheets'],
          resourceServiceId: 'google-drive',
        },
      })
    ).toContain('google_drive')
  })
})
