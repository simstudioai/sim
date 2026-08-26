/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))
vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))

import { describeServiceAccountForOAuthProvider } from '@/lib/copilot/vfs/serializers'

describe('describeServiceAccountForOAuthProvider — owning block visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits a service account whose gating block is still a preview block', () => {
    mockGetBlock.mockReturnValue({ type: 'slack_v2', preview: true })
    expect(describeServiceAccountForOAuthProvider('slack')).toBeUndefined()
  })

  it('includes it for the released owning block', () => {
    mockGetBlock.mockReturnValue({ type: 'slack_v2' })
    expect(describeServiceAccountForOAuthProvider('slack')).toEqual({ connectNoun: 'custom bot' })
  })

  it('includes it when a preview block owns the serialized tool', () => {
    mockGetBlock.mockReturnValue({ type: 'slack_v2', preview: true })

    expect(describeServiceAccountForOAuthProvider('slack', 'slack_v2')).toEqual({
      connectNoun: 'custom bot',
    })
  })

  it('fail-closes (omits) when the gating block is missing entirely', () => {
    mockGetBlock.mockReturnValue(undefined)
    expect(describeServiceAccountForOAuthProvider('slack')).toBeUndefined()
  })

  it('includes an ungated provider without consulting the block registry', () => {
    expect(describeServiceAccountForOAuthProvider('notion')).toEqual({
      connectNoun: 'integration secret',
    })
    expect(mockGetBlock).not.toHaveBeenCalled()
  })

  it('returns undefined for a provider with no service-account flow', () => {
    expect(describeServiceAccountForOAuthProvider('github')).toBeUndefined()
  })
})
