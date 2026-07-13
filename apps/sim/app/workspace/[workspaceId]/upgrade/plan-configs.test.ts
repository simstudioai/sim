/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { COMPARISON_SECTIONS } from '@/app/workspace/[workspaceId]/upgrade/components/comparison-table/comparison-data'
import {
  ENTERPRISE_PLAN_FEATURES,
  MAX_PLAN_FEATURES,
  PRO_PLAN_FEATURES,
} from '@/app/workspace/[workspaceId]/upgrade/plan-configs'

describe('upgrade plan concurrency limits', () => {
  it('shows the hosted defaults on cards and in the shared comparison data', () => {
    expect(PRO_PLAN_FEATURES).toContain('50 concurrent executions')
    expect(MAX_PLAN_FEATURES).toContain('200 concurrent executions')
    expect(ENTERPRISE_PLAN_FEATURES).toContain('1,000 concurrent executions, customizable')

    const concurrency = COMPARISON_SECTIONS.find(
      (section) => section.title === 'Execution concurrency'
    )
    expect(concurrency?.rows).toEqual([
      {
        label: 'Concurrent executions',
        values: ['10', '50', '200', '1,000 (customizable)'],
      },
    ])

    const cardFeatures = COMPARISON_SECTIONS.flatMap((section) => section.rows)
    expect(cardFeatures.slice(0, 5).at(-1)?.label).toBe('Concurrent executions')
  })
})
