import { describe, expect, it } from 'vitest'
import { loopsHandler } from '@/lib/webhooks/providers/loops'

const deliveredBody = {
  eventName: 'email.delivered',
  eventTime: 1734425918,
  webhookSchemaVersion: '1.0.0',
  sourceType: 'campaign',
  campaignId: 'cm4t1suns001uw6atri87v54s',
  email: {
    id: 'cm4t1sseg004tje7982991nan',
    emailMessageId: 'cm4ittv1v001oow9hruou8na8',
    subject: 'Subject of the email',
  },
  contactIdentity: {
    id: 'cm4ittmhq0011ow9h6fb460yw',
    email: 'test@example.com',
    userId: null,
  },
}

describe('Loops webhook provider', () => {
  it('matchEvent returns false when eventName does not match the configured trigger', async () => {
    const result = await loopsHandler.matchEvent!({
      webhook: {},
      workflow: {},
      body: deliveredBody,
      request: {} as never,
      requestId: 'test',
      providerConfig: { triggerId: 'loops_email_opened' },
    })
    expect(result).toBe(false)
  })

  it('verifyAuth returns 401 when signing secret is missing', async () => {
    const response = await loopsHandler.verifyAuth!({
      webhook: {},
      workflow: {},
      request: { headers: new Headers() } as never,
      rawBody: JSON.stringify(deliveredBody),
      requestId: 'test',
      providerConfig: {},
    })
    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })

  it('extractIdempotencyId combines eventName, email id, and eventTime', () => {
    expect(loopsHandler.extractIdempotencyId!(deliveredBody)).toBe(
      'email.delivered:cm4t1sseg004tje7982991nan:1734425918'
    )
  })
})
