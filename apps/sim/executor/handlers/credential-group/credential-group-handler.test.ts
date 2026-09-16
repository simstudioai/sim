/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { CredentialGroupBlockHandler } from '@/executor/handlers/credential-group/credential-group-handler'

describe('legacy Connected Accounts block', () => {
  it('requires explicit replacement instead of changing credential scope silently', async () => {
    await expect(new CredentialGroupBlockHandler().execute()).rejects.toThrow(
      'Replace this legacy Connected Accounts block with a Credential block'
    )
  })
})
