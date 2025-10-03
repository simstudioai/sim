#!/usr/bin/env bun

/**
 * Deregister SSO Provider Script
 *
 * This script removes an SSO provider from the database for a specific user.
 *
 * Usage: bun run packages/db/scripts/deregister-sso-provider.ts
 *
 * Required Environment Variables:
 *   DATABASE_URL=your-database-url
 *   SSO_USER_EMAIL=user@domain.com (user whose SSO provider to remove)
 *   SSO_PROVIDER_ID=provider-id (optional, if not provided will remove all providers for user)
 */

import type { ConnectionOptions } from 'node:tls'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { ssoProvider, user } from '../schema'

// Simple console logger
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

// Get database URL from environment
const CONNECTION_STRING = process.env.DATABASE_URL
if (!CONNECTION_STRING) {
  console.error('❌ DATABASE_URL environment variable is required')
  process.exit(1)
}

const getSSLConfig = () => {
  const sslMode = process.env.DATABASE_SSL?.toLowerCase()

  if (!sslMode) return undefined
  if (sslMode === 'disable') return false
  if (sslMode === 'prefer') return 'prefer'

  const sslConfig: ConnectionOptions = {}

  if (sslMode === 'require') {
    sslConfig.rejectUnauthorized = false
  } else if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
    sslConfig.rejectUnauthorized = true
    if (process.env.DATABASE_SSL_CA) {
      try {
        const ca = Buffer.from(process.env.DATABASE_SSL_CA, 'base64').toString('utf-8')
        sslConfig.ca = ca
      } catch (error) {
        console.error('Failed to parse DATABASE_SSL_CA:', error)
      }
    }
  } else {
    throw new Error(
      `Invalid DATABASE_SSL mode: ${sslMode}. Must be one of: disable, prefer, require, verify-ca, verify-full`
    )
  }

  return sslConfig
}

const sslConfig = getSSLConfig()
const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
  ...(sslConfig !== undefined && { ssl: sslConfig }),
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
    if (!userEmail) {
      logger.error('❌ SSO_USER_EMAIL environment variable is required')
      logger.error('')
      logger.error('Example usage:')
      logger.error(
        '  SSO_USER_EMAIL=admin@company.com bun run packages/db/scripts/deregister-sso-provider.ts'
      )
      logger.error('')
      logger.error('Optional: SSO_PROVIDER_ID=provider-id (to remove specific provider)')
      return false
    }

    // Get user
    const targetUser = await getUser(userEmail)
    if (!targetUser) {
      return false
    }

    logger.info(`Found user: ${targetUser.email} (ID: ${targetUser.id})`)

    // Get SSO providers for this user
    const providers = await db
      .select()
      .from(ssoProvider)
      .where(eq(ssoProvider.userId, targetUser.id))

    if (providers.length === 0) {
      logger.warn(`No SSO providers found for user: ${targetUser.email}`)
      return false
    }

    logger.info(`Found ${providers.length} SSO provider(s) for user ${targetUser.email}`)
    for (const provider of providers) {
      logger.info(`  - Provider ID: ${provider.providerId}, Domain: ${provider.domain}`)
    }

    // Check if specific provider ID was requested
    const specificProviderId = process.env.SSO_PROVIDER_ID

    if (specificProviderId) {
      // Delete specific provider
      const providerToDelete = providers.find((p) => p.providerId === specificProviderId)
      if (!providerToDelete) {
        logger.error(`Provider '${specificProviderId}' not found for user ${targetUser.email}`)
        return false
      }

      await db
        .delete(ssoProvider)
        .where(
          and(eq(ssoProvider.userId, targetUser.id), eq(ssoProvider.providerId, specificProviderId))
        )

      logger.info(
        `✅ Successfully deleted SSO provider '${specificProviderId}' for user ${targetUser.email}`
      )
    } else {
      // Delete all providers for this user
      await db.delete(ssoProvider).where(eq(ssoProvider.userId, targetUser.id))

      logger.info(
        `✅ Successfully deleted all ${providers.length} SSO provider(s) for user ${targetUser.email}`
      )
    }

    return true
  } catch (error) {
    logger.error('❌ Failed to deregister SSO provider:', {
      error: error instanceof Error ? error.message : 'Unknown error',
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

// Handle script execution
main().catch((error) => {
  logger.error('Script execution failed:', { error })
  process.exit(1)
})
