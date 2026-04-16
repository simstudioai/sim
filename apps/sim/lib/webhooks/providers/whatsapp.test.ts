/**
 * @vitest-environment node
 */
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  db: {},
  workflowDeploymentVersion: {},
}))

vi.mock('@sim/db/schema', () => ({
  webhook: {},
}))

import { whatsappHandler } from './whatsapp'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('WhatsApp webhook provider', () => {
  it('rejects deliveries when the app secret is not configured', async () => {
    const response = await whatsappHandler.verifyAuth!({
      webhook: { id: 'wh_1' },
      workflow: { id: 'wf_1' },
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 'wa-auth-missing-secret',
      providerConfig: {},
    })

    expect(response?.status).toBe(401)
    await expect(response?.text()).resolves.toBe(
      'Unauthorized - WhatsApp app secret not configured'
    )
  })

  it('accepts a valid X-Hub-Signature-256 header for the exact raw payload', async () => {
    const secret = 'test-secret'
    const rawBody =
      '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"id":"wamid.1"}]}}]}]}'
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`

    const response = await whatsappHandler.verifyAuth!({
      webhook: { id: 'wh_2' },
      workflow: { id: 'wf_2' },
      request: reqWithHeaders({ 'x-hub-signature-256': signature }),
      rawBody,
      requestId: 'wa-auth-valid-signature',
      providerConfig: { appSecret: secret },
    })

    expect(response).toBeNull()
  })

  it('builds a stable idempotency key for batched message and status payloads', () => {
    const key = whatsappHandler.extractIdempotencyId!({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [{ id: 'wamid.message.1' }],
                statuses: [
                  {
                    id: 'wamid.status.1',
                    status: 'delivered',
                    timestamp: '1700000001',
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(key).toMatch(/^whatsapp:2:[a-f0-9]{64}$/)
  })

  it('flattens batched messages and statuses into trigger-friendly outputs', async () => {
    const result = await whatsappHandler.formatInput!({
      webhook: { id: 'wh_3', providerConfig: {} },
      workflow: { id: 'wf_3', userId: 'user_3' },
      body: {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: {
                    phone_number_id: '12345',
                    display_phone_number: '+1 555 0100',
                  },
                  contacts: [
                    {
                      wa_id: '15550101',
                      profile: { name: 'Alice' },
                    },
                  ],
                  messages: [
                    {
                      id: 'wamid.message.1',
                      from: '15550101',
                      timestamp: '1700000000',
                      type: 'text',
                      text: { body: 'hello' },
                    },
                  ],
                },
              },
              {
                field: 'messages',
                value: {
                  metadata: {
                    phone_number_id: '12345',
                    display_phone_number: '+1 555 0100',
                  },
                  statuses: [
                    {
                      id: 'wamid.status.1',
                      recipient_id: '15550102',
                      status: 'delivered',
                      timestamp: '1700000001',
                      conversation: { id: 'conv_1' },
                      pricing: { category: 'utility' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      headers: {},
      requestId: 'wa-format-batch',
    })

    const input = result.input as Record<string, unknown>

    expect(input.eventType).toBe('mixed')
    expect(input.messageId).toBe('wamid.message.1')
    expect(input.phoneNumberId).toBe('12345')
    expect(input.displayPhoneNumber).toBe('+1 555 0100')
    expect(input.text).toBe('hello')
    expect(input.status).toBe('delivered')
    expect(input.contact).toEqual({
      wa_id: '15550101',
      profile: { name: 'Alice' },
    })
    expect(input.webhookContacts).toEqual([
      {
        wa_id: '15550101',
        profile: { name: 'Alice' },
      },
    ])
    expect(input.messages).toEqual([
      {
        messageId: 'wamid.message.1',
        from: '15550101',
        phoneNumberId: '12345',
        displayPhoneNumber: '+1 555 0100',
        text: 'hello',
        timestamp: '1700000000',
        messageType: 'text',
        raw: {
          id: 'wamid.message.1',
          from: '15550101',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'hello' },
        },
      },
    ])
    expect(input.statuses).toEqual([
      {
        messageId: 'wamid.status.1',
        recipientId: '15550102',
        phoneNumberId: '12345',
        displayPhoneNumber: '+1 555 0100',
        status: 'delivered',
        timestamp: '1700000001',
        conversation: { id: 'conv_1' },
        pricing: { category: 'utility' },
        raw: {
          id: 'wamid.status.1',
          recipient_id: '15550102',
          status: 'delivered',
          timestamp: '1700000001',
          conversation: { id: 'conv_1' },
          pricing: { category: 'utility' },
        },
      },
    ])
  })
})
