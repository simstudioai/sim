import { describe, expect, it } from 'vitest'
import { getActivitiesTool } from '@/tools/lemlist/get_activities'
import { getLeadTool } from '@/tools/lemlist/get_lead'
import { sendEmailTool } from '@/tools/lemlist/send_email'

describe('Lemlist Get Lead by email', () => {
  it('reads the v2 lead array that the email lookup returns', async () => {
    const transform = getLeadTool.transformResponse
    if (!transform) throw new Error('Get lead tool has no transformResponse')

    const result = await transform(
      Response.json([
        {
          _id: 'lea_1',
          isPaused: false,
          contactId: 'ctc_1',
          variables: { email: 'lead@example.com', firstName: 'Ada', companyName: 'Acme' },
          campaign: { id: 'cam_1' },
          enrichment: { emailStatus: 'deliverable' },
        },
      ])
    )

    expect(result.output).toMatchObject({
      _id: 'lea_1',
      email: 'lead@example.com',
      firstName: 'Ada',
      companyName: 'Acme',
      campaignId: 'cam_1',
      contactId: 'ctc_1',
      emailStatus: 'deliverable',
    })
  })
})

describe('Lemlist Get Activities type filter', () => {
  it('sends the plural activity type for a saved singular email type', () => {
    const url = getActivitiesTool.request.url as (params: {
      apiKey: string
      type: string
    }) => string

    expect(new URL(url({ apiKey: 'key', type: 'emailOpened' })).searchParams.get('type')).toBe(
      'emailsOpened'
    )
  })

  it('sends the prefixed Interested and Not Interested types Lemlist accepts', () => {
    const url = getActivitiesTool.request.url as (params: {
      apiKey: string
      type: string
    }) => string
    const sentType = (type: string) =>
      new URL(url({ apiKey: 'key', type })).searchParams.get('type')

    expect(sentType('interested')).toBe('emailsInterested')
    expect(sentType('notInterested')).toBe('emailsNotInterested')
  })
})

describe('Lemlist Send Email recipient', () => {
  it('omits an empty contact ID when sending by lead ID', () => {
    const body = sendEmailTool.request.body
    if (!body) throw new Error('Send email tool has no request body')

    const result = body({
      apiKey: 'key',
      sendUserId: 'usr_1',
      sendUserEmail: 'me@example.com',
      sendUserMailboxId: 'usm_1',
      contactId: '',
      leadId: 'lea_1',
      subject: 'Hi',
      message: '<p>Hi</p>',
    })

    expect(result).toEqual(expect.objectContaining({ contactId: undefined, leadId: 'lea_1' }))
  })

  it('rejects a send with neither a contact nor a lead ID', () => {
    const body = sendEmailTool.request.body
    if (!body) throw new Error('Send email tool has no request body')

    expect(() =>
      body({
        apiKey: 'key',
        sendUserId: 'usr_1',
        sendUserEmail: 'me@example.com',
        sendUserMailboxId: 'usm_1',
        subject: 'Hi',
        message: '<p>Hi</p>',
      })
    ).toThrow('Either a contact ID or a lead ID is required')
  })
})
