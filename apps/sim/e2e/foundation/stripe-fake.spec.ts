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
    const customerPayload = (await customer.json()) as { id: string }
    expect(customerPayload).toMatchObject({
      id: expect.stringMatching(/^cus_e2e_/),
    })

    const search = await fetch(
      `${baseUrl}/v1/customers/search?${new URLSearchParams({
        query: 'email:"foundation@example.com" AND -metadata["customerType"]:"organization"',
        limit: '1',
      })}`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    )
    expect(search.status).toBe(200)

    const invoices = await fetch(
      `${baseUrl}/v1/invoices?${new URLSearchParams({
        customer: customerPayload.id,
        limit: '20',
        'expand[0]': 'data.lines',
      })}`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    )
    expect(invoices.status).toBe(200)
    expect(await invoices.json()).toEqual({
      object: 'list',
      data: [],
      has_more: false,
      url: '/v1/invoices',
    })

    const telemetry = await fetch(`${baseUrl}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] }),
    })
    expect(telemetry.status).toBe(200)
    expect(
      fake.requestLog.some(
        ({ method, path, unexpected }) => method === 'POST' && path === '/v1/traces' && !unexpected
      )
    ).toBe(true)

    const unsupportedSearch = await fetch(
      `${baseUrl}/v1/customers/search?${new URLSearchParams({
        query: 'name:"Foundation"',
      })}`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    )
    expect(unsupportedSearch.status).toBe(501)

    const unsupportedInvoices = await fetch(
      `${baseUrl}/v1/invoices?${new URLSearchParams({
        customer: customerPayload.id,
        limit: '10',
        'expand[0]': 'data.lines',
      })}`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    )
    expect(unsupportedInvoices.status).toBe(501)
    expect(
      fake.requestLog.some(
        ({ method, path, unexpected }) => method === 'GET' && path === '/v1/invoices' && unexpected
      )
    ).toBe(true)

    const unknown = await fetch(`${baseUrl}/v1/payment_intents`, {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    expect(unknown.status).toBe(501)
    expect(
      fake.requestLog.some(
        ({ method, path, unexpected }) =>
          method === 'GET' && path === '/v1/payment_intents' && unexpected
      )
    ).toBe(true)
  } finally {
    await fake.stop()
  }
})
