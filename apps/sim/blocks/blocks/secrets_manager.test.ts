import { describe, expect, it } from 'vitest'
import { SecretsManagerBlock } from '@/blocks/blocks/secrets_manager'

/**
 * On an agent tool call the operation arrives only on `context`, and the merged row and model
 * values are keyed by the tool's param names (row fields hold strings). The handler forwards
 * `{ ...merged, ...mapped }`.
 */
const agentCall = (operation: string, merged: Record<string, unknown>) => ({
  ...merged,
  ...SecretsManagerBlock.tools.config?.params?.(merged, { operation }),
})

describe('SecretsManagerBlock agent tool calls', () => {
  it('coerces the max results typed in the tool row when listing secrets', () => {
    expect(agentCall('list_secrets', { maxResults: '10' })).toMatchObject({ maxResults: 10 })
  })

  it('keeps the tags the model supplied when creating a secret', () => {
    const tags = [{ Key: 'team', Value: 'core' }]
    expect(agentCall('create_secret', { name: 'db', secretValue: 'x', tags })).toMatchObject({
      tags,
    })
  })
})
