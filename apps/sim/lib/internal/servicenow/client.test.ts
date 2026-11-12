import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadServiceNowAttachment } from '@/lib/internal/servicenow/client'
import { serviceNowUploadAttachmentInputSchema } from '@/lib/internal/servicenow/schema'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const secureFetch = inputValidationMockFns.mockSecureFetchWithValidation

const UPLOAD = {
  contentType: 'text/plain',
  fileName: 'notes.txt',
  instanceUrl: 'https://acme.service-now.com',
  recordSysId: 'rec-1',
  tableName: 'incident',
}

function sentAuthorization(): unknown {
  return secureFetch.mock.lastCall?.[1]?.headers?.Authorization
}

describe('ServiceNow attachment upload sign-in', () => {
  beforeEach(() => {
    secureFetch.mockReset().mockResolvedValue(Response.json({ result: { sys_id: 'att-1' } }))
  })

  it('sends a saved OAuth client token as a bearer token without a username', async () => {
    const input = serviceNowUploadAttachmentInputSchema.parse({
      ...UPLOAD,
      password: 'minted-token',
      accessToken: 'minted-token',
      authStyle: 'bearer',
    })

    await uploadServiceNowAttachment({ ...UPLOAD, ...input }, Buffer.from('hi'))

    expect(sentAuthorization()).toBe('Bearer minted-token')
  })

  it('signs a login in with Basic exactly as before', async () => {
    const input = serviceNowUploadAttachmentInputSchema.parse({
      ...UPLOAD,
      username: 'integration.user',
      password: 'saved-password',
    })

    await uploadServiceNowAttachment({ ...UPLOAD, ...input }, Buffer.from('hi'))

    expect(sentAuthorization()).toBe(
      `Basic ${Buffer.from('integration.user:saved-password').toString('base64')}`
    )
  })

  it('still requires a username for a login', () => {
    expect(
      serviceNowUploadAttachmentInputSchema.safeParse({ ...UPLOAD, password: 'saved-password' })
        .success
    ).toBe(false)
  })
})
