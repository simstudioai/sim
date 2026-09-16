/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  accessRequestScopeSchema,
  accessRequestSettingsSchema,
  accessRequestTargetSchema,
  createAccessRequestBodySchema,
  discoverAccessRequestsQuerySchema,
  resolveAccessRequestBodySchema,
} from '@/lib/api/contracts/access-requests'

describe('access request contracts', () => {
  it('requires one explicit scope and rejects mixed or empty scope IDs', () => {
    expect(
      accessRequestScopeSchema.safeParse({ kind: 'workspace', workspaceId: 'workspace-1' }).success
    ).toBe(true)
    expect(accessRequestScopeSchema.safeParse({ kind: 'workspace', workspaceId: '' }).success).toBe(
      false
    )
    expect(
      accessRequestScopeSchema.safeParse({
        kind: 'workspace',
        workspaceId: 'ws',
        organizationId: 'org',
      }).success
    ).toBe(false)
    expect(accessRequestScopeSchema.safeParse({ workspaceId: 'ws' }).success).toBe(false)
  })

  it('accepts only boolean feature keys and known authentication modes', () => {
    expect(
      accessRequestTargetSchema.safeParse({ kind: 'feature', configKey: 'hideTablesTab' }).success
    ).toBe(true)
    for (const configKey of ['allowedIntegrations', 'constructor', 'madeUp']) {
      expect(accessRequestTargetSchema.safeParse({ kind: 'feature', configKey }).success).toBe(
        false
      )
    }
    expect(
      accessRequestTargetSchema.safeParse({ kind: 'file_share_auth', id: 'sso' }).success
    ).toBe(true)
    expect(
      accessRequestTargetSchema.safeParse({ kind: 'file_share_auth', id: 'bypass' }).success
    ).toBe(false)
    expect(
      accessRequestTargetSchema.safeParse({ kind: 'usage_limit', id: 'organization_budget' })
        .success
    ).toBe(false)
  })

  it('bounds pagination and search before discovery', () => {
    const scope = { kind: 'organization', organizationId: 'org' }
    expect(discoverAccessRequestsQuerySchema.parse(scope)).toEqual({
      ...scope,
      limit: 50,
      offset: 0,
    })
    expect(
      discoverAccessRequestsQuerySchema.parse({ ...scope, limit: '25', offset: '50' })
    ).toMatchObject({ limit: 25, offset: 50 })
    for (const override of [
      { limit: 101 },
      { limit: 0 },
      { offset: -1 },
      { search: 'a'.repeat(201) },
    ]) {
      expect(discoverAccessRequestsQuerySchema.safeParse({ ...scope, ...override }).success).toBe(
        false
      )
    }
  })

  it('allows an omitted reason while limiting submitted text and rejecting client policy patches', () => {
    const body = {
      scope: { kind: 'workspace', workspaceId: 'ws' },
      target: { kind: 'feature', configKey: 'hideTablesTab' },
    }
    expect(createAccessRequestBodySchema.parse(body).reason).toBe('')
    expect(createAccessRequestBodySchema.parse({ ...body, reason: ' Need tables ' }).reason).toBe(
      'Need tables'
    )
    expect(
      createAccessRequestBodySchema.safeParse({ ...body, reason: 'a'.repeat(1001) }).success
    ).toBe(false)
    expect(
      createAccessRequestBodySchema.safeParse({ ...body, config: { hideTablesTab: false } }).success
    ).toBe(false)
  })

  it('requires a current preview for applying and a nonblank reason for declining', () => {
    expect(resolveAccessRequestBodySchema.safeParse({ action: 'apply' }).success).toBe(false)
    expect(
      resolveAccessRequestBodySchema.safeParse({ action: 'apply', expectedFingerprint: 'sha' })
        .success
    ).toBe(true)
    expect(
      resolveAccessRequestBodySchema.safeParse({ action: 'decline', reason: '   ' }).success
    ).toBe(false)
    expect(
      resolveAccessRequestBodySchema.safeParse({
        action: 'decline',
        reason: 'Policy remains required',
        expectedFingerprint: 'sha',
      }).success
    ).toBe(false)
    for (const newLimitCredits of [0, -1, 100.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(
        resolveAccessRequestBodySchema.safeParse({
          action: 'apply',
          expectedFingerprint: 'sha',
          newLimitCredits,
        }).success
      ).toBe(false)
    }
    expect(
      resolveAccessRequestBodySchema.safeParse({
        action: 'apply',
        expectedFingerprint: 'sha',
        newLimitCredits: 100,
      }).success
    ).toBe(true)
  })

  it('accepts only the explicit boolean settings field', () => {
    expect(accessRequestSettingsSchema.safeParse({ allowRequests: false }).success).toBe(true)
    expect(accessRequestSettingsSchema.safeParse({ allowRequests: 'false' }).success).toBe(false)
    expect(
      accessRequestSettingsSchema.safeParse({ allowRequests: true, enabled: true }).success
    ).toBe(false)
  })
})
