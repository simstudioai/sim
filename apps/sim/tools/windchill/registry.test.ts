/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { hasToolId } from '@/tools/tool-ids'
import { WINDCHILL_OPERATIONS } from '@/tools/windchill/types'

describe('Windchill registry', () => {
  it('registers every operation in the global tool registry', () => {
    for (const operation of WINDCHILL_OPERATIONS) {
      expect(hasToolId(operation), operation).toBe(true)
    }
  })
})
