import { describe, expect, it } from 'vitest'
import { mailgunGetMessageTool } from '@/tools/mailgun/get_message'

describe('mailgun_get_message response', () => {
  it('reads From and Subject as the stored-message API returns them for sent mail', async () => {
    const transform = mailgunGetMessageTool.transformResponse
    if (!transform) throw new Error('get_message has no transformResponse')
    const response = new Response(
      JSON.stringify({ From: 'Ada <ada@example.com>', Subject: 'Hello', recipients: 'b@x.com' }),
      { status: 200 }
    )
    const result = await transform(response)
    expect(result.output).toMatchObject({ from: 'Ada <ada@example.com>', subject: 'Hello' })
  })
})
