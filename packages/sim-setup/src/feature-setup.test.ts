import {
  SANDBOX_CAPABILITY,
  validateCapabilityFieldInput,
} from '@sim/deployment-config/env-capabilities'
import { describe, expect, it } from 'vitest'
import type { ConfigurationSource } from './configuration-sources'
import { resolveFeatureSetupDestination } from './feature-setup'

const E2B_FUNCTION_TEMPLATE_ID = 'sim-function:00000000-0000-4000-8000-000000000001'
const DAYTONA_FUNCTION_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000002'

function source(
  kind: ConfigurationSource['kind'],
  managedByCurrentCheckout: boolean,
  values: Map<string, string> | null = new Map()
): ConfigurationSource {
  return {
    kind,
    label: `${kind} source`,
    location: `${kind} location`,
    values,
    managedByCurrentCheckout,
  }
}

describe('resolveFeatureSetupDestination', () => {
  it('refuses effective sources this checkout cannot safely update', () => {
    expect(() => resolveFeatureSetupDestination([source('dev', false)])).toThrow(
      /No effective configuration is safely writable/
    )
    expect(() => resolveFeatureSetupDestination([source('helm', false)])).toThrow(
      /No effective configuration is safely writable/
    )
  })

  it('refuses an unreadable managed source instead of claiming success', () => {
    expect(() => resolveFeatureSetupDestination([source('compose', true, null)])).toThrow(
      /effective environment could not be resolved/
    )
  })
})

describe('sandbox capability setup', () => {
  it('requires immutable Function base references', () => {
    expect(
      validateCapabilityFieldInput(
        SANDBOX_CAPABILITY,
        'DAYTONA_FUNCTION_SNAPSHOT_ID',
        DAYTONA_FUNCTION_SNAPSHOT_ID
      )
    ).toBeUndefined()
    expect(
      validateCapabilityFieldInput(
        SANDBOX_CAPABILITY,
        'DAYTONA_FUNCTION_SNAPSHOT_ID',
        'mothership-shell:v1'
      )
    ).toContain('immutable Daytona snapshot ID')
    expect(
      validateCapabilityFieldInput(
        SANDBOX_CAPABILITY,
        'E2B_FUNCTION_TEMPLATE_ID',
        E2B_FUNCTION_TEMPLATE_ID
      )
    ).toBeUndefined()
    expect(
      validateCapabilityFieldInput(
        SANDBOX_CAPABILITY,
        'E2B_FUNCTION_TEMPLATE_ID',
        'sim-function:latest'
      )
    ).toContain('immutable E2B build reference')
  })
})
