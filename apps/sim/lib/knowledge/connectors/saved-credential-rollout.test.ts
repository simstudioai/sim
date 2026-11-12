/**
 * Pins the setup gate for a key connector's saved-credential alternative. Workers from an
 * earlier release treat a key connector without a key as one whose credential was removed and
 * unschedule it, so no such connector may be set up until the switch is turned on.
 */
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { requireConnectorSavedCredentialSetup } from '@/lib/knowledge/connectors/saved-credential-rollout'
import { databricksConnectorMeta } from '@/connectors/databricks/meta'
import { s3ConnectorMeta } from '@/connectors/s3/meta'

const mockIsFeatureEnabled = featureFlagsMockFns.mockIsFeatureEnabled

describe('requireConnectorSavedCredentialSetup', () => {
  beforeEach(() => {
    mockIsFeatureEnabled.mockReset()
  })

  it('refuses to bind a saved credential to S3 while setup is off', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false)

    await expect(
      requireConnectorSavedCredentialSetup(s3ConnectorMeta.auth, 'aws-credential')
    ).rejects.toThrow(/cannot use a saved credential yet/)
  })

  it('allows a saved credential once setup is on', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true)

    await expect(
      requireConnectorSavedCredentialSetup(s3ConnectorMeta.auth, 'aws-credential')
    ).resolves.toBeUndefined()
  })

  it('leaves key setup, and key-only connectors, untouched by the switch', async () => {
    await requireConnectorSavedCredentialSetup(s3ConnectorMeta.auth, undefined)
    await requireConnectorSavedCredentialSetup(databricksConnectorMeta.auth, 'stray-credential')

    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
  })
})
