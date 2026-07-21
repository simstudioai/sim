/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureWorkspaceAccess, mockGetBlockVisibility, mockGetBlock } = vi.hoisted(() => ({
  mockEnsureWorkspaceAccess: vi.fn(),
  mockGetBlockVisibility: vi.fn(),
  mockGetBlock: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mockEnsureWorkspaceAccess,
}))

vi.mock('@/lib/copilot/block-visibility', () => ({
  getBlockVisibilityForCopilot: mockGetBlockVisibility,
}))

vi.mock('@/blocks', () => ({
  getBlock: mockGetBlock,
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeServiceAccountGetSetupLink } from '@/lib/copilot/tools/handlers/service-account'

const BASE_URL = 'https://sim.test'
const context = {
  workspaceId: 'ws-1',
  userId: 'user-1',
  chatId: 'chat-1',
} as unknown as ExecutionContext

/** slack_v2 revealed → visible. Empty → preview-hidden (fail-closed). */
function visibility(revealed: string[] = []) {
  return {
    revealed: new Set(revealed),
    disabled: new Set<string>(),
    previewTagged: new Set<string>(),
  }
}

interface Output {
  setup_url?: string
  provider?: string
  providerId?: string
  serviceAccountProviderId?: string
  connectNoun?: string
  instructions?: string
}

describe('executeServiceAccountGetSetupLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = BASE_URL
    mockEnsureWorkspaceAccess.mockResolvedValue({ canWrite: true })
    mockGetBlockVisibility.mockResolvedValue(visibility())
    mockGetBlock.mockReturnValue({ type: 'slack_v2', preview: true })
  })

  it('resolves an ungated provider to an in-chat setup tag, not a bare link', async () => {
    const result = await executeServiceAccountGetSetupLink({ providerName: 'notion' }, context)

    expect(result.success).toBe(true)
    const output = result.output as Output
    // The provider on the tag is the OAuth provider value so the button label
    // resolves; the service-account id rides alongside.
    expect(output.providerId).toBe('notion')
    expect(output.serviceAccountProviderId).toBe('notion-service-account')
    expect(output.setup_url).toContain('/integrations/notion?connect=service-account')
    // The agent is steered to emit the tag, not surface the URL as a link.
    expect(output.instructions).toContain('service_account')
    // The tool carries the secret's noun so the agent can tell the user what to
    // prepare — this is the discovery surface, replacing the reverted VFS field.
    expect(output.connectNoun).toBe('integration secret')
    expect(output.instructions).toContain('integration secret')
    // An ungated provider never consults block visibility.
    expect(mockGetBlockVisibility).not.toHaveBeenCalled()
  })

  it('rejects an unsupported provider', async () => {
    const result = await executeServiceAccountGetSetupLink({ providerName: 'github' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('no service account flow')
  })

  describe('preview gating (slack custom bot ↔ slack_v2)', () => {
    it('rejects slack-custom-bot when slack_v2 is preview-hidden, so the agent falls back to OAuth', async () => {
      // This is the exact production symptom: the tool used to return success,
      // the agent said "here's the setup form", and the in-chat button hid
      // itself because slack_v2 is preview-gated — leaving no form at all.
      mockGetBlockVisibility.mockResolvedValue(visibility([]))

      const result = await executeServiceAccountGetSetupLink({ providerName: 'slack' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('OAuth')
      expect((result.output as Output).setup_url).toContain('/integrations')
      // Crucially no service-account setup surface is offered.
      expect((result.output as Output).instructions).toBeUndefined()
    })

    it('offers slack-custom-bot once slack_v2 is revealed for the viewer', async () => {
      mockGetBlockVisibility.mockResolvedValue(visibility(['slack_v2']))

      const result = await executeServiceAccountGetSetupLink({ providerName: 'slack' }, context)

      expect(result.success).toBe(true)
      expect((result.output as Output).serviceAccountProviderId).toBe('slack-custom-bot')
    })

    it('does not consult visibility for a non-slack provider', async () => {
      await executeServiceAccountGetSetupLink({ providerName: 'google-sheets' }, context)
      expect(mockGetBlockVisibility).not.toHaveBeenCalled()
    })
  })
})
