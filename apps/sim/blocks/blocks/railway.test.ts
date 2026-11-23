import { describe, expect, it } from 'vitest'
import { RailwayBlock } from '@/blocks/blocks/railway'

const mapParams = RailwayBlock.tools.config?.params
if (!mapParams) {
  throw new Error('Railway block must define tools.config.params')
}

/**
 * On an agent tool call the operation arrives only on `context`. A yes/no dropdown filled in the
 * tool row stays the string `'true'`, which Railway's GraphQL `Boolean` variables reject.
 */
describe('Railway block agent tool calls', () => {
  it('sends a dropdown answer from the tool row as a boolean and keeps the model args', () => {
    const args = { apiKey: 'token', name: 'my-project', isPublic: false, prDeploys: 'true' }

    const params = { ...args, ...mapParams(args, { operation: 'create_project' }) }

    expect(params).toMatchObject({ name: 'my-project', isPublic: false, prDeploys: true })
  })
})
