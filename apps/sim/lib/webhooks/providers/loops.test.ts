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

const campaignSentBody = {
  eventName: 'campaign.email.sent',
  eventTime: 1734425918,
  webhookSchemaVersion: '1.0.0',
  contactIdentity: {
    id: 'cm4ittmhq0011ow9h6fb460yw',
    email: 'test@example.com',
    userId: null,
  },
  campaignId: 'cm4t1suns001uw6atri87v54s',
  campaignName: 'Test Campaign',
  email: {
    id: 'cm4t1sv84004yje79hawr1fi1',
    emailMessageId: 'cm4t1suns001ww6atotin3bn1',
    subject: 'Test Subject',
  },
  mailingLists: [
    {
      id: 'cm4ittp2k000l12j3lgrzvlxt',
      name: 'test mailing list',
      description: null,
      isPublic: true,
    },
  ],
}

describe('Loops webhook provider', () => {
  it('formatInput flattens documented email and contactIdentity fields', async () => {
    const { input } = await loopsHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body: deliveredBody,
      headers: {},
      requestId: 'test',
    })

    expect(input).toMatchObject({
      eventName: 'email.delivered',
      eventTime: 1734425918,
      webhookSchemaVersion: '1.0.0',
      sourceType: 'campaign',
      campaignId: 'cm4t1suns001uw6atri87v54s',
      emailId: 'cm4t1sseg004tje7982991nan',
      emailMessageId: 'cm4ittv1v001oow9hruou8na8',
      subject: 'Subject of the email',
      contactId: 'cm4ittmhq0011ow9h6fb460yw',
      contactEmail: 'test@example.com',
      userId: null,
    })
  })

  it('formatInput flattens sent-event campaignName, loopName, and mailingLists fields', async () => {
    const { input } = await loopsHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body: campaignSentBody,
      headers: {},
      requestId: 'test',
    })

    expect(input).toMatchObject({
      eventName: 'campaign.email.sent',
      sourceType: null,
      campaignId: 'cm4t1suns001uw6atri87v54s',
      campaignName: 'Test Campaign',
      loopId: null,
      loopName: null,
      transactionalId: null,
      emailId: 'cm4t1sv84004yje79hawr1fi1',
      emailMessageId: 'cm4t1suns001ww6atotin3bn1',
      subject: 'Test Subject',
      contactId: 'cm4ittmhq0011ow9h6fb460yw',
      contactEmail: 'test@example.com',
      mailingLists: campaignSentBody.mailingLists,
    })
  })

  it('matchEvent returns true for a sent event matching the configured trigger', async () => {
    const result = await loopsHandler.matchEvent!({
      webhook: {},
      workflow: {},
      body: campaignSentBody,
      request: {} as never,
      requestId: 'test',
      providerConfig: { triggerId: 'loops_campaign_email_sent' },
    })
    expect(result).toBe(true)
  })

  it('matchEvent returns true when eventName matches the configured trigger', async () => {
    const result = await loopsHandler.matchEvent!({
      webhook: {},
      workflow: {},
      body: deliveredBody,
      request: {} as never,
      requestId: 'test',
      providerConfig: { triggerId: 'loops_email_delivered' },
    })
    expect(result).toBe(true)
  })

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
