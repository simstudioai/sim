import { describe, expect, it } from 'vitest'
import { GoogleFormsBlock } from '@/blocks/blocks/google_forms'

/**
 * On an agent tool call the operation arrives only in `context`, never in the stored row params.
 */
describe('GoogleFormsBlock agent tool calls', () => {
  it('maps a get_responses call instead of rejecting the missing params operation', () => {
    const inputs = { oauthCredential: 'cred-1', formId: ' form-1 ', pageSize: 5 }
    const mapped = GoogleFormsBlock.tools.config?.params?.(inputs, { operation: 'get_responses' })
    expect(mapped).toMatchObject({ formId: 'form-1', pageSize: 5 })
  })
})
