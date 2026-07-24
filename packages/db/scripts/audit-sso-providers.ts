#!/usr/bin/env bun

import postgres from 'postgres'
import {
  auditSSOProviderSnapshot,
  loadLegacySSOProviderAuditSnapshot,
  parseApprovedSSOProviderIds,
} from '../sso-provider-audit'

const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('POSTGRES_URL or DATABASE_URL is required')
}

const client = postgres(connectionString, {
  prepare: false,
  max: 1,
  onnotice: () => {},
})

try {
  const result = auditSSOProviderSnapshot(
    await loadLegacySSOProviderAuditSnapshot(client),
    parseApprovedSSOProviderIds(process.env.SSO_AUDIT_APPROVED_PROVIDER_IDS)
  )
  for (const link of result.links) {
    console.log(
      `${link.providerId}: ${link.linkedUserCount} linked user(s), ${link.activeSessionCount} active session(s)`
    )
  }

  if (result.findings.length > 0) {
    console.error('SSO provider audit failed:')
    for (const finding of result.findings) console.error(`- ${finding}`)
    process.exitCode = 1
  } else {
    console.log(`SSO provider audit passed (${result.providerCount} provider rows checked).`)
  }
} finally {
  await client.end({ timeout: 5 })
}
