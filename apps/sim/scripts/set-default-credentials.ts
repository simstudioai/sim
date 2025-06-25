#!/usr/bin/env bun

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { account } from '../db/schema'
import { setDefaultCredentialForProvider } from '../lib/oauth/utils'

/**
 * Script to set default credentials for all existing Google providers
 * This ensures that when users have multiple credentials for the same provider,
 * one is automatically selected as default
 */
async function setDefaultCredentialsForAllProviders() {
  console.log('🔧 Setting default credentials for all providers...')

  try {
    // Get all unique provider IDs from the database
    const providers = await db
      .selectDistinct({ providerId: account.providerId })
      .from(account)

    console.log(`Found ${providers.length} unique providers`)

    for (const { providerId } of providers) {
      console.log(`Processing provider: ${providerId}`)

      // Get all users who have credentials for this provider
      const users = await db
        .selectDistinct({ userId: account.userId })
        .from(account)
        .where(eq(account.providerId, providerId))

      console.log(`  Found ${users.length} users with ${providerId} credentials`)

      for (const { userId } of users) {
        try {
          await setDefaultCredentialForProvider(userId, providerId)
          console.log(`  ✅ Set default credential for user ${userId} and provider ${providerId}`)
        } catch (error) {
          console.error(`  ❌ Error setting default credential for user ${userId} and provider ${providerId}:`, error)
        }
      }
    }

    console.log('✅ Finished setting default credentials for all providers')
  } catch (error) {
    console.error('❌ Error in setDefaultCredentialsForAllProviders:', error)
    process.exit(1)
  }
}

// Run the script if called directly
if (import.meta.main) {
  await setDefaultCredentialsForAllProviders()
  process.exit(0)
} 