import { describe, expect, it } from 'vitest'
import { GoogleTasksBlock } from '@/blocks/blocks/google_tasks'

/**
 * The executor builds tool params as `{ ...inputs, ...transformedParams }`, so an empty dropdown
 * value the serializer fills in reaches the tool unless the mapper assigns that key explicitly.
 */
describe('GoogleTasksBlock list filters', () => {
  const mapParams = GoogleTasksBlock.tools.config?.params as (
    params: Record<string, unknown>
  ) => Record<string, unknown>

  it('maps unset tri-state filters to undefined', () => {
    const mapped = mapParams({
      operation: 'list',
      oauthCredential: 'cred-1',
      showHidden: '',
      showDeleted: '',
      showAssigned: '',
    })
    for (const key of ['showHidden', 'showDeleted', 'showAssigned']) {
      expect(mapped).toHaveProperty(key, undefined)
    }
  })

  it('converts chosen filters to booleans', () => {
    const mapped = mapParams({ operation: 'list', oauthCredential: 'cred-1', showHidden: 'true' })
    expect(mapped.showHidden).toBe(true)
  })
})
