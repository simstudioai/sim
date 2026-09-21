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

  it('rebuilds the projections a push drops, since their indexes and triggers are not in the schema', () => {
    const scripts = pushCommands([]).map((command) => command.at(-1))
    expect(scripts.slice(-2)).toEqual([
      './script-migrations/0019_tin_keyword_projection.ts',
      './script-migrations/0021_embedding_search_connector.ts',
    ])
  })
})
