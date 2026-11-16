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

  it.each([
    { operation: 'create_form', inputs: { documentTitle: 'd' }, missing: 'title' },
    { operation: 'create_watch', inputs: { formId: 'f', topicName: 't' }, missing: 'eventType' },
    {
      operation: 'create_watch',
      inputs: { formId: 'f', eventType: 'RESPONSES' },
      missing: 'topicName',
    },
    { operation: 'delete_watch', inputs: { formId: 'f' }, missing: 'watchId' },
    { operation: 'renew_watch', inputs: { formId: 'f' }, missing: 'watchId' },
  ])(
    'leaves a $missing the model omitted on $operation for the required-param check',
    ({ operation, inputs, missing }) => {
      const mapped = GoogleFormsBlock.tools.config?.params?.(
        { oauthCredential: 'cred-1', ...inputs },
        { operation }
      )
      expect(mapped?.[missing]).toBeUndefined()
    }
  )
})
