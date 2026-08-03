import { describe, expect, it } from 'bun:test'
import type { ConfigurationSource } from './configuration-sources.ts'
import {
  reconcileLlmSetup,
  reconcileSandboxSetup,
  resolveFeatureSetupDestination,
  validateDaytonaSnapshotInput,
} from './feature-setup.ts'

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

describe('validateDaytonaSnapshotInput', () => {
  it('requires an explicit non-floating snapshot tag', () => {
    expect(validateDaytonaSnapshotInput('mothership-shell:v1')).toBeUndefined()
    expect(validateDaytonaSnapshotInput('mothership-shell')).toContain('name:tag')
    expect(validateDaytonaSnapshotInput('mothership-shell:latest')).toContain('name:tag')
  })
})

describe('reconcileSandboxSetup', () => {
  it('writes Daytona API and shell snapshot configuration and disables E2B', () => {
    const result = reconcileSandboxSetup({
      provider: 'daytona',
      apiKey: 'daytona-key',
      shellSnapshotId: 'mothership-shell:v1',
    })

    expect(result.remove).toContain('E2B_API_KEY')
    expect(result.values).toMatchObject({
      DAYTONA_API_KEY: 'daytona-key',
      DAYTONA_SHELL_SNAPSHOT_ID: 'mothership-shell:v1',
      E2B_ENABLED: 'false',
      NEXT_PUBLIC_E2B_ENABLED: 'false',
      NEXT_PUBLIC_SANDBOX_ENABLED: 'true',
    })
  })

  it('removes stale Daytona configuration for E2B and disabled modes', () => {
    expect(reconcileSandboxSetup({ provider: 'e2b', apiKey: 'e2b-key' }).remove).toEqual(
      expect.arrayContaining(['DAYTONA_API_KEY', 'DAYTONA_SHELL_SNAPSHOT_ID'])
    )
    expect(reconcileSandboxSetup({ provider: 'disabled' }).remove).toEqual(
      expect.arrayContaining(['DAYTONA_API_KEY', 'DAYTONA_SHELL_SNAPSHOT_ID'])
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
