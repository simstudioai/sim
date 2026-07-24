import { readFileSync } from 'node:fs'
import type { Sql } from 'postgres'
import { parse as parseDomain } from 'tldts'
import { ssoDomainsOverlap } from './sso-domain'

export const SSO_HARDENING_MIGRATION_TAG = '0266_zippy_the_phantom'

const RESERVED_PROVIDER_IDS = new Set(['google', 'github', 'email-password'])

export interface LegacySSOProviderRow {
  id: string
  providerId: string
  organizationId: string | null
  domain: string
}

export interface SSOProviderLinkSummary {
  providerId: string
  linkedUserCount: number
  activeSessionCount: number
}

export interface SSOProviderAuditSnapshot {
  providers: LegacySSOProviderRow[]
  links: SSOProviderLinkSummary[]
}

export interface SSOProviderAuditResult {
  findings: string[]
  links: SSOProviderLinkSummary[]
  providerCount: number
}

export function parseApprovedSSOProviderIds(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((providerId) => providerId.trim())
      .filter(Boolean)
  )
}

export function auditSSOProviderSnapshot(
  snapshot: SSOProviderAuditSnapshot,
  approvedProviderIds: ReadonlySet<string>
): SSOProviderAuditResult {
  const findings: string[] = []
  const linkByProviderId = new Map(snapshot.links.map((summary) => [summary.providerId, summary]))

  for (const provider of snapshot.providers) {
    if (!provider.organizationId) {
      findings.push(`${provider.providerId}: missing organization ownership`)
    }
    if (!isValidProviderId(provider.providerId)) {
      findings.push(`${provider.providerId}: invalid provider ID`)
    }
    if (!isRegistrableDomain(provider.domain)) {
      findings.push(`${provider.providerId}: '${provider.domain}' is not a registrable domain`)
    }

    const linkSummary = linkByProviderId.get(provider.providerId)
    if (
      linkSummary &&
      linkSummary.linkedUserCount > 0 &&
      !approvedProviderIds.has(provider.providerId)
    ) {
      findings.push(
        `${provider.providerId}: linked users/sessions require an explicit retain-or-migrate decision in SSO_AUDIT_APPROVED_PROVIDER_IDS`
      )
    }
  }

  for (let leftIndex = 0; leftIndex < snapshot.providers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshot.providers.length; rightIndex += 1) {
      const left = snapshot.providers[leftIndex]
      const right = snapshot.providers[rightIndex]
      if (left.providerId === right.providerId) {
        findings.push(`duplicate provider ID: ${left.providerId}`)
      }
      if (left.organizationId && left.organizationId === right.organizationId) {
        findings.push(`organization ${left.organizationId} owns multiple providers`)
      }
      if (ssoDomainsOverlap(left.domain, right.domain)) {
        findings.push(`overlapping domains: ${left.domain} and ${right.domain}`)
      }
    }
  }

  return {
    findings: [...new Set(findings)],
    links: snapshot.links,
    providerCount: snapshot.providers.length,
  }
}

/**
 * Loads only columns that existed before migration 0266. This must remain
 * compatible with the legacy schema because it is the migration's preflight.
 */
export async function loadLegacySSOProviderAuditSnapshot(
  sql: Sql
): Promise<SSOProviderAuditSnapshot> {
  const providers = await sql<
    Array<{
      id: string
      provider_id: string
      organization_id: string | null
      domain: string
    }>
  >`
    SELECT id, provider_id, organization_id, domain
    FROM sso_provider
    ORDER BY id
  `
  const links = await sql<
    Array<{
      provider_id: string
      linked_user_count: number
      active_session_count: number
    }>
  >`
    SELECT
      linked.provider_id,
      count(DISTINCT linked.user_id)::integer AS linked_user_count,
      count(session.id) FILTER (WHERE session.expires_at > now())::integer
        AS active_session_count
    FROM (
      SELECT DISTINCT account.provider_id, account.user_id
      FROM account
      INNER JOIN sso_provider
        ON sso_provider.provider_id = account.provider_id
    ) AS linked
    LEFT JOIN session
      ON session.user_id = linked.user_id
    GROUP BY linked.provider_id
    ORDER BY linked.provider_id
  `

  return {
    providers: providers.map((provider) => ({
      id: provider.id,
      providerId: provider.provider_id,
      organizationId: provider.organization_id,
      domain: provider.domain,
    })),
    links: links.map((summary) => ({
      providerId: summary.provider_id,
      linkedUserCount: summary.linked_user_count,
      activeSessionCount: summary.active_session_count,
    })),
  }
}

export async function isSSOHardeningMigrationApplied(sql: Sql): Promise<boolean> {
  const [{ journal_exists: journalExists }] = await sql<
    Array<{ journal_exists: boolean }>
  >`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal_exists`
  if (!journalExists) return false

  const migrationTimestamp = readSSOHardeningMigrationTimestamp()
  const [{ applied }] = await sql.unsafe<Array<{ applied: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM drizzle.__drizzle_migrations
       WHERE created_at = ${migrationTimestamp}
     ) AS applied`
  )
  return applied
}

export function resolveSSOHardeningMigrationTimestamp(journal: unknown): number {
  if (
    typeof journal !== 'object' ||
    journal === null ||
    !('entries' in journal) ||
    !Array.isArray(journal.entries)
  ) {
    throw new Error('Drizzle migration journal has no entries array')
  }
  const entry = journal.entries.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'tag' in candidate &&
      candidate.tag === SSO_HARDENING_MIGRATION_TAG
  )
  if (
    typeof entry !== 'object' ||
    entry === null ||
    !('when' in entry) ||
    typeof entry.when !== 'number'
  ) {
    throw new Error(`Drizzle migration journal is missing ${SSO_HARDENING_MIGRATION_TAG}`)
  }
  return entry.when
}

function readSSOHardeningMigrationTimestamp(): number {
  const journal = JSON.parse(
    readFileSync(new URL('./migrations/meta/_journal.json', import.meta.url), 'utf8')
  )
  return resolveSSOHardeningMigrationTimestamp(journal)
}

function isValidProviderId(value: string): boolean {
  return (
    value.length <= 44 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) &&
    !RESERVED_PROVIDER_IDS.has(value)
  )
}

function isRegistrableDomain(value: string): boolean {
  const parsed = parseDomain(value, { allowPrivateDomains: true, validateHostname: true })
  return (
    value === value.trim().toLowerCase() &&
    !value.includes(',') &&
    !parsed.isIp &&
    Boolean(parsed.domain) &&
    parsed.hostname === value &&
    Boolean(parsed.publicSuffix) &&
    Boolean(parsed.isIcann || parsed.isPrivate) &&
    parsed.publicSuffix !== value
  )
}
