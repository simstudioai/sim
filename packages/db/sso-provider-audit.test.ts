import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import {
  auditSSOProviderSnapshot,
  isSSOHardeningMigrationApplied,
  loadLegacySSOProviderAuditSnapshot,
  parseApprovedSSOProviderIds,
  resolveSSOHardeningMigrationTimestamp,
  SSO_HARDENING_MIGRATION_TAG,
  type SSOProviderAuditSnapshot,
} from './sso-provider-audit'

const VALID_PROVIDER = {
  id: 'provider-row-1',
  providerId: 'acme-saml',
  organizationId: 'organization-1',
  domain: 'login.acme.com',
}

describe('SSO provider audit', () => {
  it('accepts a valid organization provider without account links', () => {
    expect(
      auditSSOProviderSnapshot({ providers: [VALID_PROVIDER], links: [] }, new Set()).findings
    ).toEqual([])
  })

  it('accepts a registrable tenant under a known private suffix', () => {
    const provider = {
      ...VALID_PROVIDER,
      providerId: 'private-suffix',
      domain: 'tenant.github.io',
    }
    expect(
      auditSSOProviderSnapshot({ providers: [provider], links: [] }, new Set()).findings
    ).toEqual([])
  })

  it('rejects domains below an unknown public suffix', () => {
    const provider = { ...VALID_PROVIDER, domain: 'tenant.invalid' }
    expect(
      auditSSOProviderSnapshot({ providers: [provider], links: [] }, new Set()).findings
    ).toEqual(["acme-saml: 'tenant.invalid' is not a registrable domain"])
  })

  it('reports every legacy invariant that requires remediation', () => {
    const snapshot: SSOProviderAuditSnapshot = {
      providers: [
        {
          id: 'provider-row-1',
          providerId: 'google',
          organizationId: null,
          domain: 'COM',
        },
        {
          id: 'provider-row-2',
          providerId: 'duplicate',
          organizationId: 'organization-2',
          domain: 'acme.com',
        },
        {
          id: 'provider-row-3',
          providerId: 'duplicate',
          organizationId: 'organization-2',
          domain: 'login.acme.com',
        },
      ],
      links: [],
    }

    expect(auditSSOProviderSnapshot(snapshot, new Set()).findings).toEqual(
      expect.arrayContaining([
        'google: missing organization ownership',
        'google: invalid provider ID',
        "google: 'COM' is not a registrable domain",
        'duplicate provider ID: duplicate',
        'organization organization-2 owns multiple providers',
        'overlapping domains: acme.com and login.acme.com',
      ])
    )
  })

  it('keeps linked-account approval separate and explicit', () => {
    const snapshot: SSOProviderAuditSnapshot = {
      providers: [VALID_PROVIDER],
      links: [
        {
          providerId: VALID_PROVIDER.providerId,
          linkedUserCount: 2,
          activeSessionCount: 1,
        },
      ],
    }

    expect(auditSSOProviderSnapshot(snapshot, new Set()).findings).toEqual([
      'acme-saml: linked users/sessions require an explicit retain-or-migrate decision in SSO_AUDIT_APPROVED_PROVIDER_IDS',
    ])
    expect(
      auditSSOProviderSnapshot(snapshot, parseApprovedSSOProviderIds(' other, acme-saml ')).findings
    ).toEqual([])
  })

  it('loads only columns available before migration 0266', async () => {
    const queries: string[] = []
    const fakeSql = ((strings: TemplateStringsArray) => {
      const query = strings.join('?').replace(/\s+/g, ' ').trim()
      queries.push(query)
      if (query.includes('SELECT id, provider_id')) {
        return Promise.resolve([
          {
            id: VALID_PROVIDER.id,
            provider_id: VALID_PROVIDER.providerId,
            organization_id: VALID_PROVIDER.organizationId,
            domain: VALID_PROVIDER.domain,
          },
        ])
      }
      return Promise.resolve([
        {
          provider_id: VALID_PROVIDER.providerId,
          linked_user_count: 1,
          active_session_count: 1,
        },
      ])
    }) as unknown as Sql

    await expect(loadLegacySSOProviderAuditSnapshot(fakeSql)).resolves.toEqual({
      providers: [VALID_PROVIDER],
      links: [
        {
          providerId: VALID_PROVIDER.providerId,
          linkedUserCount: 1,
          activeSessionCount: 1,
        },
      ],
    })
    expect(queries.join('\n')).not.toContain('domain_verified')
    expect(queries[0]).toContain('SELECT id, provider_id, organization_id, domain')
  })
})

describe('SSO hardening migration state', () => {
  it('is pending before the drizzle journal exists', async () => {
    const unsafe = vi.fn()
    const fakeSql = Object.assign(
      (() => Promise.resolve([{ journal_exists: false }])) as unknown as Sql,
      { unsafe }
    )

    await expect(isSSOHardeningMigrationApplied(fakeSql)).resolves.toBe(false)
    expect(unsafe).not.toHaveBeenCalled()
  })

  it('uses the 0266 journal timestamp instead of post-migration columns', async () => {
    const unsafe = vi.fn().mockResolvedValue([{ applied: true }])
    const fakeSql = Object.assign(
      (() => Promise.resolve([{ journal_exists: true }])) as unknown as Sql,
      { unsafe }
    )

    await expect(isSSOHardeningMigrationApplied(fakeSql)).resolves.toBe(true)
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('created_at = 1784759628537'))
  })

  it('resolves the migration timestamp by tag and fails closed if it is renamed', () => {
    expect(
      resolveSSOHardeningMigrationTimestamp({
        entries: [{ tag: SSO_HARDENING_MIGRATION_TAG, when: 123 }],
      })
    ).toBe(123)
    expect(() => resolveSSOHardeningMigrationTimestamp({ entries: [] })).toThrow(
      `missing ${SSO_HARDENING_MIGRATION_TAG}`
    )
  })
})
