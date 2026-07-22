/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))
vi.mock('@/blocks', () => ({ getBlock: mockGetBlock }))

import { describeServiceAccountForOAuthProvider } from '@/lib/copilot/vfs/serializers'

describe('describeServiceAccountForOAuthProvider — preview gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits a service account whose gating block is still a preview block', () => {
    mockGetBlock.mockReturnValue({ type: 'slack_v2', preview: true })
    expect(describeServiceAccountForOAuthProvider('slack')).toBeUndefined()
  })

  it('includes it once the gating block GAs and drops preview', () => {
    // slack_v2's documented GA migration removes `preview`. Discovery must then
    // surface the custom bot, matching what the UI shows. A hand-rolled
    // `?.preview ?? true` would keep it omitted forever — the "sticks after GA"
    // regression; reusing isHiddenUnder(null, block) fixes it.
    mockGetBlock.mockReturnValue({ type: 'slack_v2' })
    expect(describeServiceAccountForOAuthProvider('slack')).toEqual({ connectNoun: 'custom bot' })
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
