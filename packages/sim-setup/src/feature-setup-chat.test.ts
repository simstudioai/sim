import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDiscoverConfigurationSources,
  mockReconcileEnvValues,
  mockPromptCopilotKey,
  mockMothershipOverride,
  mockChatFlagValues,
  mockOutro,
} = vi.hoisted(() => ({
  mockDiscoverConfigurationSources: vi.fn(),
  mockReconcileEnvValues: vi.fn(),
  mockPromptCopilotKey: vi.fn(),
  mockMothershipOverride: vi.fn(),
  mockChatFlagValues: vi.fn(),
  mockOutro: vi.fn(),
}))

vi.mock('./configuration-sources', () => ({
  discoverConfigurationSources: mockDiscoverConfigurationSources,
}))

vi.mock('./env-files', () => ({
  reconcileEnvValues: mockReconcileEnvValues,
}))

vi.mock('./prompter', () => ({
  outro: mockOutro,
}))

vi.mock('./steps', () => ({
  chatFlagValues: mockChatFlagValues,
  mothershipOverride: mockMothershipOverride,
  promptCopilotKey: mockPromptCopilotKey,
}))

vi.mock('./theme', () => ({
  theme: { accent: (value: string) => value },
}))

import { runFeatureSetup } from './feature-setup'

describe('Chat feature setup', () => {
  beforeEach(() => {
    mockDiscoverConfigurationSources.mockReturnValue([
      {
        kind: 'compose',
        label: 'Docker Compose',
        location: '.env',
        values: new Map([['COPILOT_API_KEY', 'existing-key']]),
        managedByCurrentCheckout: true,
      },
    ])
    mockMothershipOverride.mockReturnValue({
      SIM_AGENT_API_URL: 'https://copilot.example.com',
    })
    mockChatFlagValues.mockReturnValue({ NEXT_PUBLIC_CHAT_DISABLED: 'false' })
  })

  it('fails without changing configuration when no key is received', async () => {
    mockPromptCopilotKey.mockResolvedValue(null)

    await expect(runFeatureSetup('chat', [])).rejects.toThrow(
      'Chat setup did not receive an API key. No configuration was changed.'
    )
    expect(mockReconcileEnvValues).not.toHaveBeenCalled()
  })
})
