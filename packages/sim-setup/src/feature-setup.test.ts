import {
  SANDBOX_CAPABILITY,
  validateCapabilityFieldInput,
} from '@sim/deployment-config/env-capabilities'
import { describe, expect, it } from 'vitest'
import { SANDBOX_SETUP } from './capability-config'
import { buildCapabilitySetupTransition } from './capability-setup'
import type { ConfigurationSource } from './configuration-sources'
import { reconcileLlmSetup, resolveFeatureSetupDestination } from './feature-setup'

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
  it('uses the effective values of the one setup-managed source', () => {
    const effective = new Map([['RESEND_API_KEY', 'effective-key']])
    const destination = resolveFeatureSetupDestination([
      source('compose', false),
      source('dev', true, effective),
    ])

    expect(destination.target).toBe('sim')
    expect(destination.containerized).toBe(false)
    expect(destination.vars).toBe(effective)
  })

  it('maps a managed Compose source to the root env file', () => {
    const destination = resolveFeatureSetupDestination([source('compose', true)])

    expect(destination.target).toBe('root')
    expect(destination.containerized).toBe(true)
  })

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

  it('writes Daytona API and Function snapshot configuration and disables E2B', () => {
    const result = buildCapabilitySetupTransition(
      SANDBOX_SETUP,
      'daytona',
      {
        DAYTONA_API_KEY: 'daytona-key',
        DAYTONA_FUNCTION_SNAPSHOT_ID,
      },
      {}
    )

    expect(result.remove).toContain('E2B_API_KEY')
    expect(result.values).toMatchObject({
      DAYTONA_API_KEY: 'daytona-key',
      DAYTONA_FUNCTION_SNAPSHOT_ID,
      E2B_ENABLED: 'false',
      NEXT_PUBLIC_E2B_ENABLED: 'false',
      NEXT_PUBLIC_SANDBOXES_ENABLED: 'true',
    })
  })

  it('removes stale Daytona configuration for E2B and disabled modes', () => {
    expect(
      buildCapabilitySetupTransition(
        SANDBOX_SETUP,
        'e2b',
        {
          E2B_API_KEY: 'e2b-key',
          E2B_FUNCTION_TEMPLATE_ID,
          E2B_FUNCTION_TEMPLATE_GENERATION: '1',
        },
        {}
      ).remove
    ).toEqual(expect.arrayContaining(['DAYTONA_API_KEY', 'DAYTONA_FUNCTION_SNAPSHOT_ID']))
    expect(buildCapabilitySetupTransition(SANDBOX_SETUP, 'disabled', {}, {}).remove).toEqual(
      expect.arrayContaining(['DAYTONA_API_KEY', 'DAYTONA_FUNCTION_SNAPSHOT_ID'])
    )
  })
})

describe('reconcileLlmSetup', () => {
  it('removes trailing rotation keys omitted after empty-to-finish', () => {
    expect(reconcileLlmSetup('openai', { OPENAI_API_KEY_1: 'replacement' })).toEqual({
      values: { OPENAI_API_KEY_1: 'replacement' },
      remove: ['OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'OPENAI_API_KEY'],
    })
  })

  it('removes a legacy fallback when rotation keys replace it', () => {
    expect(reconcileLlmSetup('fireworks', { FIREWORKS_API_KEY_1: 'replacement' })).toEqual({
      values: { FIREWORKS_API_KEY_1: 'replacement' },
      remove: ['FIREWORKS_API_KEY_2', 'FIREWORKS_API_KEY_3', 'FIREWORKS_API_KEY'],
    })
  })
})
