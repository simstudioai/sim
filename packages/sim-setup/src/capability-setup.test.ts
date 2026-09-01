import { describe, expect, it } from 'vitest'
import type { SetupFieldPrompt } from './capability-config'
import { formatCapabilitySetupFieldMessage, markCurrentlyUsed } from './capability-setup'

describe('capability setup presentation', () => {
  it('marks the effective option as currently used without replacing its hint', () => {
    expect(markCurrentlyUsed('paste an API key', true)).toBe('paste an API key · Currently used')
    expect(markCurrentlyUsed(undefined, true)).toBe('Currently used')
    expect(markCurrentlyUsed('paste an API key', false)).toBe('paste an API key')
  })

  it('marks existing fields and explains how secrets are preserved', () => {
    const prompt: SetupFieldPrompt = {
      type: 'field',
      key: 'RESEND_API_KEY',
      input: 'secret',
    }

    expect(formatCapabilitySetupFieldMessage(prompt, true, true)).toBe(
      'RESEND_API_KEY (Currently used); leave empty to keep it'
    )
    expect(formatCapabilitySetupFieldMessage(prompt, false, true)).toBe('RESEND_API_KEY')
  })
})
