/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/tools/registry')

import { tools } from '@/tools/registry'
import { WINDCHILL_OPERATIONS } from '@/tools/windchill/types'

describe('Windchill registry', () => {
  it('registers every operation in the global tool registry', () => {
    for (const operation of WINDCHILL_OPERATIONS) {
      expect(tools[operation]?.id).toBe(operation)
    }
  })
})
