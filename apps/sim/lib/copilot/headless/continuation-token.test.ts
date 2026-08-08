import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { BETTER_AUTH_SECRET: 'test-v2-chat-secret-that-is-at-least-32-characters' },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import {
  issueV2ChatContinuationToken,
  V2_CHAT_CONTINUATION_TTL_SECONDS,
  verifyV2ChatContinuationToken,
} from './continuation-token'

const NOW = 1_800_000_000
const binding = {
  workspaceId: 'workspace-1',
  authorizationUserId: 'key-owner-1',
  credentialType: 'personal' as const,
  readOnly: false,
}

describe('v2 chat continuation tokens', () => {
  beforeEach(() => {
    mockEnv.BETTER_AUTH_SECRET = 'test-v2-chat-secret-that-is-at-least-32-characters'
  })

  it('round-trips the private chat id only for its bound principal and workspace', async () => {
    const token = await issueV2ChatContinuationToken({
      ...binding,
      chatId: 'chat-private-1',
      now: NOW,
    })

    await expect(verifyV2ChatContinuationToken(token, binding, NOW + 1)).resolves.toEqual({
      valid: true,
      chatId: 'chat-private-1',
    })
    await expect(
      verifyV2ChatContinuationToken(token, { ...binding, workspaceId: 'workspace-2' }, NOW + 1)
    ).resolves.toEqual({ valid: false })
    await expect(
      verifyV2ChatContinuationToken(
        token,
        { ...binding, authorizationUserId: 'other-user' },
        NOW + 1
      )
    ).resolves.toEqual({ valid: false })
    await expect(
      verifyV2ChatContinuationToken(token, { ...binding, readOnly: true }, NOW + 1)
    ).resolves.toEqual({ valid: false })
    await expect(
      verifyV2ChatContinuationToken(token, { ...binding, credentialType: 'workspace' }, NOW + 1)
    ).resolves.toEqual({ valid: false })
  })

  it('authenticates the optional Sim persistence claim without changing legacy tokens', async () => {
    const syncedToken = await issueV2ChatContinuationToken({
      ...binding,
      chatId: 'chat-synced-1',
      persistence: 'sim',
      now: NOW,
    })
    const legacyToken = await issueV2ChatContinuationToken({
      ...binding,
      chatId: 'chat-legacy-1',
      now: NOW,
    })

    await expect(verifyV2ChatContinuationToken(syncedToken, binding, NOW + 1)).resolves.toEqual({
      valid: true,
      chatId: 'chat-synced-1',
      persistence: 'sim',
    })
    await expect(verifyV2ChatContinuationToken(legacyToken, binding, NOW + 1)).resolves.toEqual({
      valid: true,
      chatId: 'chat-legacy-1',
    })
  })

  it('rejects tampering and expiry', async () => {
    const token = await issueV2ChatContinuationToken({
      ...binding,
      chatId: 'chat-private-1',
      now: NOW,
    })
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`

    await expect(verifyV2ChatContinuationToken(tampered, binding, NOW + 1)).resolves.toEqual({
      valid: false,
    })
    await expect(
      verifyV2ChatContinuationToken(token, binding, NOW + V2_CHAT_CONTINUATION_TTL_SECONDS)
    ).resolves.toEqual({ valid: false })
  })

  it('encrypts the claims with a fresh nonce so decoding token segments cannot reveal the chat id', async () => {
    const chatId = 'chat-private-1'
    const token = await issueV2ChatContinuationToken({ ...binding, chatId, now: NOW })
    const nextToken = await issueV2ChatContinuationToken({ ...binding, chatId, now: NOW })
    const [prefix, ...encodedSegments] = token.split('.')

    expect(prefix).toBe('sim-v2-chat-v1')
    expect(encodedSegments).toHaveLength(1)
    expect(nextToken).not.toBe(token)
    expect(token).not.toContain(chatId)
    for (const segment of encodedSegments) {
      expect(Buffer.from(segment, 'base64url').toString('utf8')).not.toContain(chatId)
    }
  })
})
