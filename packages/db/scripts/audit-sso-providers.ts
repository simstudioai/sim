#!/usr/bin/env bun

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { parse as parseDomain } from 'tldts'
import { account, session, ssoProvider } from '../schema'

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('POSTGRES_URL or DATABASE_URL is required')
}

const RESERVED_PROVIDER_IDS = new Set(['google', 'github', 'email-password'])

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
    parsed.hostname === value &&
    Boolean(parsed.publicSuffix) &&
    parsed.publicSuffix !== value
  )
}

function domainsOverlap(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

const client = postgres(connectionString, {
  prepare: false,
  max: 1,
  onnotice: () => {},
})

try {
  const db = drizzle(client)
  const [providers, accountLinks, activeSessions] = await Promise.all([
    db.select().from(ssoProvider),
    db.select({ providerId: account.providerId, userId: account.userId }).from(account),
    db.select({ userId: session.userId, expiresAt: session.expiresAt }).from(session),
  ])
  const findings: string[] = []
  const approvedProviderIds = new Set(
    (process.env.SSO_AUDIT_APPROVED_PROVIDER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
  const now = Date.now()

  for (const provider of providers) {
    if (!provider.organizationId) {
      findings.push(`${provider.providerId}: missing organization ownership`)
    }
    if (!isValidProviderId(provider.providerId)) {
      findings.push(`${provider.providerId}: invalid provider ID`)
    }
    if (!isRegistrableDomain(provider.domain)) {
      findings.push(`${provider.providerId}: '${provider.domain}' is not a registrable domain`)
    }

    const linkedUserIds = new Set(
      accountLinks
        .filter((link) => link.providerId === provider.providerId)
        .map((link) => link.userId)
    )
    const sessionCount = activeSessions.filter(
      (candidate) => linkedUserIds.has(candidate.userId) && candidate.expiresAt.getTime() > now
    ).length
    if (linkedUserIds.size > 0) {
      console.log(
        `${provider.providerId}: ${linkedUserIds.size} linked user(s), ${sessionCount} active session(s)`
      )
      if (!approvedProviderIds.has(provider.providerId)) {
        findings.push(
          `${provider.providerId}: linked users/sessions require an explicit retain-or-migrate decision in SSO_AUDIT_APPROVED_PROVIDER_IDS`
        )
      }
    }
  }

  for (let leftIndex = 0; leftIndex < providers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < providers.length; rightIndex += 1) {
      const left = providers[leftIndex]
      const right = providers[rightIndex]
      if (left.providerId === right.providerId) {
        findings.push(`duplicate provider ID: ${left.providerId}`)
      }
      if (left.organizationId && left.organizationId === right.organizationId) {
        findings.push(`organization ${left.organizationId} owns multiple providers`)
      }
      if (domainsOverlap(left.domain, right.domain)) {
        findings.push(`overlapping domains: ${left.domain} and ${right.domain}`)
      }
    }
  }

  if (findings.length > 0) {
    console.error('SSO provider audit failed:')
    for (const finding of [...new Set(findings)]) console.error(`- ${finding}`)
    process.exitCode = 1
  } else {
    console.log(`SSO provider audit passed (${providers.length} provider rows checked).`)
  }
} finally {
  await client.end({ timeout: 5 })
}
