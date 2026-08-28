/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createConfigurationSet: vi.fn(),
  createEmailIdentity: vi.fn(),
  createSESClient: vi.fn(),
  createTemplate: vi.fn(),
  deleteEmailIdentity: vi.fn(),
  deleteSuppressedDestination: vi.fn(),
  deleteTemplate: vi.fn(),
  getAccount: vi.fn(),
  getEmailIdentity: vi.fn(),
  getSuppressedDestination: vi.fn(),
  getTemplate: vi.fn(),
  listIdentities: vi.fn(),
  listSuppressedDestinations: vi.fn(),
  listTemplates: vi.fn(),
  parseBulkEmailDestinations: vi.fn(),
  putSuppressedDestination: vi.fn(),
  sendBulkEmail: vi.fn(),
  sendCustomVerificationEmail: vi.fn(),
  sendEmail: vi.fn(),
  sendTemplatedEmail: vi.fn(),
  updateTemplate: vi.fn(),
}))

vi.mock('@/lib/internal/ses/client', () => clientMocks)

import {
  executeSesGetAccount,
  executeSesListSuppressedDestinations,
  executeSesSendBulkEmail,
  SesOperationInputError,
} from '@/lib/internal/ses/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
} as const

describe('SES operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the abort signal to SES and destroys the client after success', async () => {
    const controller = new AbortController()
    const client = { destroy: vi.fn() }
    clientMocks.createSESClient.mockReturnValue(client)
    clientMocks.getAccount.mockResolvedValue({
      sendingEnabled: true,
      max24HourSend: 1000,
      maxSendRate: 10,
      sentLast24Hours: 25,
    })

    await expect(executeSesGetAccount(CONNECTION, controller.signal)).resolves.toMatchObject({
      sendingEnabled: true,
    })

    expect(clientMocks.createSESClient).toHaveBeenCalledWith(CONNECTION)
    expect(clientMocks.getAccount).toHaveBeenCalledWith(client, controller.signal)
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the SES client when the provider rejects', async () => {
    const client = { destroy: vi.fn() }
    clientMocks.createSESClient.mockReturnValue(client)
    clientMocks.getAccount.mockRejectedValue(new Error('provider failed'))

    await expect(executeSesGetAccount(CONNECTION)).rejects.toThrow('provider failed')
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('rejects malformed bulk destinations before creating an SES client', async () => {
    clientMocks.parseBulkEmailDestinations.mockImplementation(() => {
      throw new Error('invalid JSON')
    })

    expect(() =>
      executeSesSendBulkEmail({
        ...CONNECTION,
        fromAddress: 'sender@example.com',
        templateName: 'template',
        destinations: 'not-json',
      })
    ).toThrow(
      new SesOperationInputError('destinations must be a valid JSON array of destination objects')
    )
    expect(clientMocks.createSESClient).not.toHaveBeenCalled()
  })

  it('rejects invalid suppression reasons before creating an SES client', async () => {
    expect(() =>
      executeSesListSuppressedDestinations({ ...CONNECTION, reasons: 'BOUNCE,INVALID' })
    ).toThrow(
      new SesOperationInputError(
        'Invalid suppression reason(s): INVALID. Must be one of: BOUNCE, COMPLAINT'
      )
    )
    expect(clientMocks.createSESClient).not.toHaveBeenCalled()
  })
})
