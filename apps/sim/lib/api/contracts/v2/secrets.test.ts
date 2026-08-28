/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  v2DeleteSecretContract,
  v2SecretSchema,
  v2SecretWithValueSchema,
  v2SetSecretBodySchema,
  v2SetSecretContract,
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

/** Reads the `name` field description off a contract's path-parameter schema. */
function nameDescription(params: unknown): string | undefined {
  const shape = (params as { shape: Record<string, { description?: string }> }).shape
  return shape.name.description
}

describe('secret path-parameter descriptions', () => {
  it('does not offer writes on the delete path parameter', () => {
    const description = nameDescription(v2DeleteSecretContract.params)

    expect(description).toBe('Secret to delete.')
    expect(description).not.toMatch(/create|replace/i)
  })

  it('does not offer deletion on the set path parameter', () => {
    expect(nameDescription(v2SetSecretContract.params)).not.toMatch(/delete/i)
  })

  it('gives the two operations distinct path-parameter prose', () => {
    expect(nameDescription(v2SetSecretContract.params)).not.toBe(
      nameDescription(v2DeleteSecretContract.params)
    )
  })
})

describe('v2SetSecretBodySchema metadata-only write', () => {
  it('accepts a workspace body carrying only unredacted, so restoring redaction costs no value', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'workspace',
      unredacted: false,
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.value).toBeUndefined()
  })

  it('accepts a workspace body carrying only a description', () => {
    expect(
      v2SetSecretBodySchema.safeParse({
        workspaceId: 'workspace-1',
        scope: 'workspace',
        description: 'Prod billing key',
      }).success
    ).toBe(true)
  })

  it('rejects a workspace body with nothing to write rather than resolving to an empty update', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'workspace',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ['value'],
          message: 'value, description, or unredacted is required',
        }),
      ])
    }
  })

  it('still requires a value for a personal secret, which has no metadata field to write', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'personal',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ['value'],
          message: 'value is required for a personal secret',
        }),
      ])
    }
  })

  it('keeps rejecting an empty value, which is a write and not an omission', () => {
    expect(
      v2SetSecretBodySchema.safeParse({
        workspaceId: 'workspace-1',
        scope: 'workspace',
        value: '',
      }).success
    ).toBe(false)
  })
})
