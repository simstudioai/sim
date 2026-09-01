/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { getBlock } from '@/blocks/registry'

const mockGetBlock = getBlock as unknown as ReturnType<typeof vi.fn>

interface FakeBlock {
  hideFromToolbar?: boolean
  sunset?: { status: 'legacy' | 'deprecated'; replacedBy?: string }
}

/**
 * Only `hideFromToolbar` is read from here: the successor half of the decision
 * comes from the generated map, so every id used below is a real one whose real
 * successor the assertion depends on.
 */
function registry(blocks: Record<string, FakeBlock>) {
  mockGetBlock.mockImplementation((type: string) => blocks[type])
}

describe('isBlockTypeAccessControlExempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exempts the universal entry point', () => {
    registry({})

    expect(isBlockTypeAccessControlExempt('start_trigger')).toBe(true)
  })

  /**
   * The bypass this closes: a legacy block is fully functional, so an allowlist
   * naming only the current version used to be satisfied by the retired one.
   */
  it('does not exempt a superseded block, which is judged as its successor', () => {
    registry({
      slack: { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'slack_v2' } },
      slack_v2: {},
    })

    expect(isBlockTypeAccessControlExempt('slack')).toBe(false)
  })

  /**
   * A retired block with no successor has no row in the editor and nothing to
   * be permitted as, so denying it would break older workflows an admin could
   * not have rescued.
   */
  it('exempts a retired block with no successor', () => {
    registry({ thinking: { hideFromToolbar: true } })

    expect(isBlockTypeAccessControlExempt('thinking')).toBe(true)
  })

  it('does not exempt a current block', () => {
    registry({ slack_v2: {} })

    expect(isBlockTypeAccessControlExempt('slack_v2')).toBe(false)
  })

  /**
   * The editor never offers `start_trigger` as an allowlist row, so a retired
   * entry point judged as its successor would be refused by every active
   * allowlist — breaking every saved workflow that still carries one.
   */
  it('exempts a retired entry point, whose successor is the universal one', () => {
    registry({
      starter: { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'start_trigger' } },
      manual_trigger: {
        hideFromToolbar: true,
        sunset: { status: 'legacy', replacedBy: 'start_trigger' },
      },
      start_trigger: {},
    })

    expect(isBlockTypeAccessControlExempt('starter')).toBe(true)
    expect(isBlockTypeAccessControlExempt('manual_trigger')).toBe(true)
  })
})
