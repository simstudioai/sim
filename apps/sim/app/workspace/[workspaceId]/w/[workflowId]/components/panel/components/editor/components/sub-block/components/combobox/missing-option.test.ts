/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { shouldClearMissingOption } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/combobox/missing-option'

const BASE = {
  clearOnMissingOption: true,
  missingOptionId: 'sandbox-deleted',
  currentValue: 'sandbox-deleted',
  isPreview: false,
  disabled: false,
}

describe('shouldClearMissingOption', () => {
  it('clears only the same value an authoritative lookup found missing', () => {
    expect(shouldClearMissingOption(BASE)).toBe(true)
    expect(shouldClearMissingOption({ ...BASE, currentValue: 'sandbox-new' })).toBe(false)
  })

  it('does not clear on fetch failures, language mismatches, or expressions', () => {
    expect(shouldClearMissingOption({ ...BASE, missingOptionId: null })).toBe(false)
    expect(
      shouldClearMissingOption({
        ...BASE,
        missingOptionId: null,
        currentValue: '<Block.sandboxId>',
      })
    ).toBe(false)
  })

  it('does not mutate previews, disabled editors, or controls without opt-in', () => {
    expect(shouldClearMissingOption({ ...BASE, isPreview: true })).toBe(false)
    expect(shouldClearMissingOption({ ...BASE, disabled: true })).toBe(false)
    expect(shouldClearMissingOption({ ...BASE, clearOnMissingOption: false })).toBe(false)
  })
})
