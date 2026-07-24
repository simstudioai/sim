#!/usr/bin/env bun

/**
 * Deregister SSO Provider Script
 *
 * This script removes one audited organization SSO provider when it has no
 * Better Auth account links.
 *
 * Usage: bun run packages/db/scripts/deregister-sso-provider.ts
 *
 * Required Environment Variables:
 *   DATABASE_URL=your-database-url
 *   SSO_USER_EMAIL=user@domain.com (must be an organization owner/admin)
 *   SSO_ORGANIZATION_ID=organization-id
 *   SSO_PROVIDER_ID=provider-id
 */

import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { account, member, ssoProvider, user, verification } from '../schema'
import {
  SSO_CALLBACK_INTENT_PREFIX,
  SSO_DOMAIN_VERIFICATION_INTENT_PREFIX,
  SSO_PROVIDER_MUTATION_LOCK_KEY,
} from '../sso-lock'

const logger = {
  info: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.log(
      `[${timestamp}] [INFO] [DeregisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
  error: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.error(
      `[${timestamp}] [ERROR] [DeregisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
  warn: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.warn(
      `[${timestamp}] [WARN] [DeregisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
}

const CONNECTION_STRING = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
if (!CONNECTION_STRING) {
  console.error('❌ POSTGRES_URL or DATABASE_URL environment variable is required')
  process.exit(1)
}

const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
})
const db = drizzle(postgresClient)

async function getUser(email: string): Promise<{ id: string; email: string } | null> {
  try {
    const users = await db.select().from(user).where(eq(user.email, email))
    if (users.length === 0) {
      logger.error(`No user found with email: ${email}`)
      return null
    }
    return { id: users[0].id, email: users[0].email }
  } catch (error) {
    logger.error('Failed to query user:', error)
    return null
  }
}

async function deregisterSSOProvider(): Promise<boolean> {
  try {
    const userEmail = process.env.SSO_USER_EMAIL
    const organizationId = process.env.SSO_ORGANIZATION_ID?.trim()
    const specificProviderId = process.env.SSO_PROVIDER_ID?.trim()
    if (!userEmail || !organizationId || !specificProviderId) {
      logger.error('❌ SSO_USER_EMAIL, SSO_ORGANIZATION_ID, and SSO_PROVIDER_ID are all required')
      logger.error('')
      logger.error('Example usage:')
      logger.error(
        '  SSO_USER_EMAIL=admin@company.com SSO_ORGANIZATION_ID=org-id SSO_PROVIDER_ID=provider-id bun run packages/db/scripts/deregister-sso-provider.ts'
      )
      return false
    }

    const targetUser = await getUser(userEmail)
    if (!targetUser) {
      return false
    }

    logger.info(`Found user: ${targetUser.email} (ID: ${targetUser.id})`)

    const memberships = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUser.id)))
    if (!memberships.some(({ role }) => role === 'owner' || role === 'admin')) {
      logger.error('SSO_USER_EMAIL must be an owner or admin of SSO_ORGANIZATION_ID')
      return false
    }

    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SSO_PROVIDER_MUTATION_LOCK_KEY}::bigint)`)
      const providers = await tx
        .select()
        .from(ssoProvider)
        .where(
          and(
            eq(ssoProvider.organizationId, organizationId),
            eq(ssoProvider.providerId, specificProviderId)
          )
        )

      if (providers.length === 0) {
        logger.warn(
          `Provider '${specificProviderId}' was not found in organization '${organizationId}'`
        )
        return false
      }

      const [activeCallback] = await tx
        .select({ id: verification.id })
        .from(verification)
        .where(
          and(
            inArray(verification.identifier, [
              `${SSO_CALLBACK_INTENT_PREFIX}${specificProviderId}`,
              `${SSO_DOMAIN_VERIFICATION_INTENT_PREFIX}${specificProviderId}`,
            ]),
            gt(verification.expiresAt, new Date())
          )
        )
        .limit(1)
      if (activeCallback) {
        logger.error('Refusing to delete a provider while an SSO operation is in progress')
        return false
      }

      const linkedAccounts = await tx
        .select({ id: account.id })
        .from(account)
        .where(eq(account.providerId, specificProviderId))
        .limit(1)
      if (linkedAccounts.length > 0) {
        logger.error(
          'Refusing to delete a provider with Better Auth account links; migrate links and sessions first'
        )
        return false
      }

      await tx.delete(ssoProvider).where(eq(ssoProvider.id, providers[0].id))
      return true
    })
    if (!deleted) return false
    logger.info(
      `✅ Successfully deleted SSO provider '${specificProviderId}' from organization '${organizationId}'`
    )

    return true
  } catch (error) {
    logger.error('❌ Failed to deregister SSO provider:', {
      error: getErrorMessage(error, 'Unknown error'),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return false
  } finally {
    try {
      await postgresClient.end({ timeout: 5 })
    } catch {}
  }
}

async function main() {
  console.log('🗑️  Deregister SSO Provider Script')
  console.log('====================================')
  console.log('This script removes SSO provider records from the database.\n')

  const success = await deregisterSSOProvider()

  if (success) {
    console.log('\n🎉 SSO provider deregistration completed successfully!')
    process.exit(0)
  } else {
    console.log('\n💥 SSO deregistration failed. Check the logs above for details.')
    process.exit(1)
  }
}

main().catch((error) => {
  logger.error('Script execution failed:', { error })
  process.exit(1)
})
