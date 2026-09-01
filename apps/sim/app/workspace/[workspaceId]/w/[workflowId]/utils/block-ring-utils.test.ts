import { describe, expect, it } from 'vitest'
import { getBlockRingStyles } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/block-ring-utils'

const IDLE_OPTIONS = {
  isExecuting: false,
  isEditorOpen: false,
  isPending: false,
  isDeletedBlock: false,
  diffStatus: null,
  isPreviewSelection: false,
  isSelected: false,
} as const

describe('getBlockRingStyles', () => {
  it('does not render an outline for execution alone', () => {
    expect(getBlockRingStyles({ ...IDLE_OPTIONS, isExecuting: true })).toEqual({
      hasRing: false,
      ringClassName: '',
    })
  })

  it('preserves the selection ring while a selected block executes', () => {
    const result = getBlockRingStyles({
      ...IDLE_OPTIONS,
      isExecuting: true,
      isSelected: true,
    })

    expect(result.hasRing).toBe(true)
    expect(result.ringClassName).toContain('ring-[var(--text-secondary)]')
    expect(result.ringClassName).not.toContain('animate-ring-pulse')
    expect(result.ringClassName).not.toContain('ring-[var(--border-success)]')
  })

  it('preserves non-execution status rings while idle', () => {
    const result = getBlockRingStyles({
      ...IDLE_OPTIONS,
      diffStatus: 'new',
    })

    expect(result.hasRing).toBe(true)
    expect(result.ringClassName).toContain('ring-[var(--brand-accent)]')
  })
})
