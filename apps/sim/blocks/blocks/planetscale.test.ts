import { describe, expect, it } from 'vitest'
import { PlanetScaleBlock } from '@/blocks/blocks/planetscale'

const mapParams = PlanetScaleBlock.tools.config?.params
if (!mapParams) {
  throw new Error('PlanetScale block must define tools.config.params')
}

/**
 * On an agent tool call the operation arrives only on `context` and the model sends the tool's
 * `state` param, which the block collects as `backupState`, `deployRequestState`, or `reviewState`.
 */
describe('PlanetScale block agent tool calls', () => {
  it('keeps the state filter the model sent', () => {
    const args = { organization: 'org', database: 'db', branch: 'main', state: 'success' }

    const params = { ...args, ...mapParams(args, { operation: 'list_backups' }) }

    expect(params.state).toBe('success')
  })
})
