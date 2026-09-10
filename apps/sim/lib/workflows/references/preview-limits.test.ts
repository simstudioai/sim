/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { assertWorkflowPreviewFits } from '@/lib/workflows/references/preview-limits'

describe('expanded workflow preview bounds', () => {
  it('rejects an expanded field collection before response validation', () => {
    expect(() => assertWorkflowPreviewFits({ configuration: Array(10001).fill({}) })).toThrow(
      'configuration exceeds 10000'
    )
  })

  it('bounds aggregate UTF-8 bytes even when every collection fits its item limit', () => {
    const value = '😀'.repeat(1024)
    expect(() => assertWorkflowPreviewFits({ configuration: Array(3000).fill({ value }) })).toThrow(
      '10 MiB'
    )
    expect(() =>
      assertWorkflowPreviewFits({ configuration: Array(1000).fill({ value }) })
    ).not.toThrow()
  })
})
