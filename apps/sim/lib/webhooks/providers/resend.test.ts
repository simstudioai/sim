import { describe, expect, it } from 'vitest'
import { resendHandler } from '@/lib/webhooks/providers/resend'

describe('Resend webhook provider', () => {
  it('formatInput exposes documented email metadata and distinct data.created_at', async () => {
    const { input } = await resendHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body: {
        type: 'email.bounced',
        created_at: '2024-11-22T23:41:12.126Z',
        data: {
          broadcast_id: '8b146471-e88e-4322-86af-016cd36fd216',
          created_at: '2024-11-22T23:41:11.894719+00:00',
          email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
          from: 'Acme <onboarding@resend.dev>',
          to: ['delivered@resend.dev'],
          subject: 'Sending this example',
          template_id: '43f68331-0622-4e15-8202-246a0388854b',
          tags: { category: 'confirm_email' },
          bounce: {
            message: 'Hard bounce',
            subType: 'Suppressed',
            type: 'Permanent',
          },
        },
      },
      headers: {},
      requestId: 'test',
    })

    expect(input).toMatchObject({
      type: 'email.bounced',
      created_at: '2024-11-22T23:41:12.126Z',
      data_created_at: '2024-11-22T23:41:11.894719+00:00',
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      broadcast_id: '8b146471-e88e-4322-86af-016cd36fd216',
      template_id: '43f68331-0622-4e15-8202-246a0388854b',
      tags: { category: 'confirm_email' },
      bounceType: 'Permanent',
      bounceSubType: 'Suppressed',
      bounceMessage: 'Hard bounce',
    })
  })
})
