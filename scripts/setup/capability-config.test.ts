import { describe, expect, it } from 'bun:test'
import {
  defineCapability,
  ENV_CAPABILITIES,
  envField,
  OAUTH_CLIENT_CAPABILITIES,
} from '../../apps/sim/lib/core/config/env-capabilities.ts'
import {
  CAPABILITY_SETUPS,
  defineCapabilitySetup,
  EMAIL_SETUP,
  getOAuthClientSetupFields,
  STORAGE_SETUP,
} from './capability-config.ts'
import { getCapabilitySetupOptions } from './capability-setup.ts'

describe('capability setup configuration', () => {
  it('maps every runtime capability and provider exactly once', () => {
    expect(CAPABILITY_SETUPS.map((setup) => setup.definition.id)).toEqual(
      ENV_CAPABILITIES.map((capability) => capability.id)
    )
    for (const setup of CAPABILITY_SETUPS) {
      expect(Object.keys(setup.providers).sort()).toEqual(
        setup.definition.providers.map((provider) => provider.id).sort()
      )
    }
  })

  it('fails fast when CLI prompts omit a runtime-owned provider field', () => {
    const definition = defineCapability({
      strategy: 'fallback',
      id: 'sample',
      label: 'Sample',
      providers: [
        {
          id: 'remote',
          label: 'Remote',
          activation: { mode: 'any-present', keys: ['REMOTE_KEY'] },
          requires: envField('REMOTE_KEY'),
        },
      ],
    } as const)

    expect(() =>
      defineCapabilitySetup(definition, {
        label: 'Sample',
        message: 'Sample provider?',
        actions: {},
        providers: { remote: { prompts: [] } },
        optionOrder: ['remote'],
      } as never)
    ).toThrow(/missing: REMOTE_KEY/)

    expect(() =>
      defineCapabilitySetup(definition, {
        label: 'Sample',
        message: 'Sample provider?',
        actions: {},
        providers: {
          remote: {
            env: { MISSPELLED_REMOTE_KEY: 'true' },
            prompts: [{ type: 'field', key: 'REMOTE_KEY', input: 'secret' }],
          },
        },
        optionOrder: ['remote'],
      })
    ).toThrow(/unknown: MISSPELLED_REMOTE_KEY/)
  })

  it('keeps presets out of the generic provider choices', () => {
    expect(getCapabilitySetupOptions(EMAIL_SETUP).map((option) => option.id)).not.toContain(
      'mailhog'
    )
    expect(getCapabilitySetupOptions(STORAGE_SETUP).map((option) => option.id)).not.toContain(
      's3-compatible'
    )
  })

  it('maps every OAuth runtime field to a CLI input mode in runtime order', () => {
    for (const id of Object.keys(OAUTH_CLIENT_CAPABILITIES) as Array<
      keyof typeof OAUTH_CLIENT_CAPABILITIES
    >) {
      expect(getOAuthClientSetupFields(id).map((field) => field.key)).toEqual(
        OAUTH_CLIENT_CAPABILITIES[id]
      )
    }
  })
})
