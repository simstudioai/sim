/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  v2SecretSchema,
  v2SecretWithValueSchema,
  v2SetSecretBodySchema,
} from '@/lib/api/contracts/v2/secrets'

const secret = {
  name: 'STRIPE_API_KEY',
  scope: 'workspace' as const,
  description: null,
  role: 'admin' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('v2SetSecretBodySchema unredacted', () => {
  it('rejects unredacted on a personal secret at the flag itself', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'personal',
      value: 'secret-value',
      unredacted: true,
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ['unredacted'],
          message: 'unredacted is only supported for a workspace secret',
        }),
      ])
    }
  })

  it('accepts unredacted on a workspace secret', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'workspace',
      value: 'secret-value',
      unredacted: true,
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.unredacted).toBe(true)
  })
})

describe('v2SecretSchema unredacted', () => {
  it('requires the field so a response cannot silently drop it', () => {
    expect(v2SecretSchema.safeParse(secret).success).toBe(false)
    expect(v2SecretSchema.safeParse({ ...secret, unredacted: false }).success).toBe(true)
  })
})

describe('v2SecretWithValueSchema value', () => {
  it('parses with and without a value, so only visible rows need to carry one', () => {
    const metadata = { ...secret, unredacted: false }
    expect(v2SecretWithValueSchema.safeParse(metadata).success).toBe(true)
    expect(
      v2SecretWithValueSchema.safeParse({
        ...secret,
        unredacted: true,
        value: 'https://staging.example.com',
      }).success
    ).toBe(true)
  })
})
