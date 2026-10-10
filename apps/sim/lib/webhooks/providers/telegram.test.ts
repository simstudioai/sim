import { webhook } from '@sim/db/schema'
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { environmentUtilsMockFns } from '@sim/testing/mocks/environment-utils.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

import { telegramHandler } from '@/lib/webhooks/providers/telegram'
import type { AuthContext, SubscriptionContext } from '@/lib/webhooks/providers/types'

const BOT_TOKEN = '123456789:test-bot-token'
const update = { update_id: 1, message: { message_id: 7, date: 0, text: 'hi' } }

function verify(providerConfig: Record<string, unknown>, headers: Record<string, string> = {}) {
  const context = {
    request: createMockRequest('POST', update, headers),
    rawBody: JSON.stringify(update),
    requestId: 'r1',
    providerConfig,
    webhook: {},
    workflow: {},
  } satisfies AuthContext
  return telegramHandler.verifyAuth?.(context) ?? null
}

function secretHeader(secret: string) {
  return { 'x-telegram-bot-api-secret-token': secret }
}

describe('telegramHandler.verifyAuth', () => {
  const secretToken = 'stored_secret-Token123'

  it('rejects a delivery without the secret header once a secret is stored', async () => {
    expect((await verify({ secretToken }))?.status).toBe(401)
  })

  it('rejects a delivery carrying a different secret', async () => {
    expect((await verify({ secretToken }, secretHeader('forged_secret-Token12')))?.status).toBe(401)
  })

  it('accepts a delivery carrying the stored secret', async () => {
    expect(await verify({ secretToken }, secretHeader(secretToken))).toBeNull()
  })

  it('keeps accepting legacy webhooks registered before a secret was stored', async () => {
    expect(await verify({ botToken: BOT_TOKEN })).toBeNull()
  })
})

describe('telegramHandler.createSubscription', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  const ctx = {
    webhook: {
      id: 'candidate-row',
      workflowId: 'wf-1',
      path: 'telegram-path',
      providerConfig: { botToken: BOT_TOKEN },
    },
    workflow: { id: 'wf-1' },
    userId: 'u1',
    requestId: 'r1',
    request: createMockRequest('POST', {}),
  } satisfies SubscriptionContext

  async function subscribe() {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: true }, 200))
    vi.stubGlobal('fetch', fetchMock)
    const result = await telegramHandler.createSubscription?.(ctx)
    const [, init] = fetchMock.mock.calls[0]
    const registeredSecret: unknown = JSON.parse(init.body).secret_token
    const storedConfig = { botToken: BOT_TOKEN, ...result?.providerConfigUpdates }
    return { registeredSecret, storedConfig }
  }

  it('registers a secret with Telegram that the stored config then verifies', async () => {
    const { registeredSecret, storedConfig } = await subscribe()

    expect(registeredSecret).toMatch(/^[A-Za-z0-9_-]{1,256}$/)
    expect(await verify(storedConfig, secretHeader(String(registeredSecret)))).toBeNull()
    expect((await verify(storedConfig))?.status).toBe(401)
  })

  it('reuses the active deployment secret so cutover deliveries verify on both rows', async () => {
    const activeConfig = { botToken: BOT_TOKEN, secretToken: 'active_deployment-secret' }
    queueTableRows(webhook, [{ id: 'active-row', providerConfig: activeConfig }])

    const { registeredSecret, storedConfig } = await subscribe()
    const delivery = secretHeader(String(registeredSecret))

    expect(await verify(activeConfig, delivery)).toBeNull()
    expect(await verify(storedConfig, delivery)).toBeNull()
  })
})

describe('Telegram bot tokens stored as environment variable references', () => {
  const storedToken = '{{TELEGRAM_BOT_TOKEN}}'
  const activeConfig = { botToken: storedToken, secretToken: 'active_deployment-secret' }
  const workflow = { id: 'wf-1', userId: 'owner-1', workspaceId: 'ws-1' }
  const resolvedWebhook = {
    id: 'candidate-row',
    workflowId: 'wf-1',
    path: 'telegram-path',
    providerConfig: { botToken: BOT_TOKEN },
  }

  beforeEach(() => {
    resetDbChainMock()
    billingAttributionMockFns.mockGetWorkspaceBilledAccountUserId.mockResolvedValue('owner-1')
    environmentUtilsMockFns.mockGetExecutionEnvironment.mockResolvedValue({
      personalDecrypted: {},
      workspaceDecrypted: { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
    })
    queueTableRows(webhook, [{ id: 'active-row', providerConfig: activeConfig }])
  })

  it('reuses the active secret when the active row stores the token as a reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: true }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await telegramHandler.createSubscription?.({
      webhook: resolvedWebhook,
      workflow,
      userId: 'owner-1',
      requestId: 'r1',
      request: createMockRequest('POST', {}),
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body).secret_token).toBe(activeConfig.secretToken)
  })

  it('leaves the bot webhook in place when the active deployment uses the same referenced bot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: true }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await telegramHandler.deleteSubscription?.({
      webhook: { ...resolvedWebhook, id: 'retired-row' },
      workflow,
      requestId: 'r1',
      strict: true,
    })

    const telegramCalls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(telegramCalls.some((url) => url.endsWith('/deleteWebhook'))).toBe(false)
  })
})
