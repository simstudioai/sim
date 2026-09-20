/**
 * @vitest-environment node
 */

import { pushCommands } from '@sim/db/scripts/push'
import { describe, expect, it } from 'vitest'

describe('pushCommands', () => {
  it('forwards push flags to Drizzle before any reconciliation step', () => {
    expect(pushCommands(['--force'])[0]).toEqual([
      'bunx',
      'drizzle-kit',
      'push',
      '--config=./drizzle.config.ts',
      '--force',
    ])
  })

  it('rebuilds the Tin keyword projection a push drops, since its index is not in the schema', () => {
    const scripts = pushCommands([]).map((command) => command.at(-1))
    expect(scripts.at(-1)).toBe('./script-migrations/0019_tin_keyword_projection.ts')
  })
})
