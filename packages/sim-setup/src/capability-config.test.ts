import {
  defineCapability,
  ENV_CAPABILITIES,
  envField,
} from '@sim/deployment-config/env-capabilities'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_SETUPS, defineCapabilitySetup } from './capability-config'

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
})
