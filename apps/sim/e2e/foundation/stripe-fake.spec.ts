import { expect, test } from '@playwright/test'
import { startStripeFakeServer } from '../fakes/stripe/server'

test('Stripe fake records allowlisted calls and rejects unknown routes', async () => {
  const apiKey = 'sk_test_foundation_fake_spec'
  const fake = await startStripeFakeServer({ apiKey })
  try {
    const baseUrl = fake.baseUrl
    expect(baseUrl).toBeTruthy()

    const health = await fetch(`${baseUrl}/health`)
    expect(health.status).toBe(200)

    const customer = await fetch(`${baseUrl}/v1/customers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'foundation@example.com',
        'metadata[userId]': 'user-foundation',
      }),
    })
    expect(customer.status).toBe(200)
    expect((await customer.json()) as { id: string }).toMatchObject({
      id: expect.stringMatching(/^cus_e2e_/),
    })

    const unknown = await fetch(`${baseUrl}/v1/invoices`, {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    expect(unknown.status).toBe(501)
    expect(fake.requestLog.some(({ unexpected }) => unexpected)).toBe(true)
  } finally {
    await fake.stop()
  }
})
