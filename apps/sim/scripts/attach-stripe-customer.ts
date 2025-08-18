#!/usr/bin/env tsx

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

// Configuration
const USER_ID = '7vBgXHU57ySMa47wIW8TKVW6rEJJu2Gl'
const STRIPE_CUSTOMER_ID = 'cus_S8ZPqjzSGC4hvv'

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required')
    process.exit(1)
  }

  console.log('🔍 Attaching Stripe Customer to User')
  console.log('=====================================')
  console.log(`User ID: ${USER_ID}`)
  console.log(`Stripe Customer ID: ${STRIPE_CUSTOMER_ID}`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'EXECUTE'}`)
  console.log(`Database: ${databaseUrl.split('@')[1] || 'Hidden'}`)
  console.log()

  // Initialize database connection
  const postgresClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })
  const db = drizzle(postgresClient, { schema })

  try {
    // Step 1: Find the user
    console.log('🔍 Step 1: Finding user in database...')
    const users = await db.select().from(schema.user).where(eq(schema.user.id, USER_ID)).limit(1)

    if (users.length === 0) {
      console.error(`❌ User with ID ${USER_ID} not found`)
      await postgresClient.end()
      process.exit(1)
    }

    const user = users[0]
    console.log(`✅ User found: ${user.email} (${user.name})`)
    console.log(`   Created: ${user.createdAt}`)
    console.log(`   Current Stripe Customer ID: ${user.stripeCustomerId || 'None'}`)
    console.log()

    // Step 2: Check if user already has a Stripe customer
    if (user.stripeCustomerId) {
      if (user.stripeCustomerId === STRIPE_CUSTOMER_ID) {
        console.log('✅ User already has the correct Stripe customer ID attached')
        await postgresClient.end()
        return
      }
      console.warn(`⚠️  User already has a different Stripe customer ID: ${user.stripeCustomerId}`)
      console.warn('   This script will overwrite it with the new one.')
      console.log()
    }

    // Step 3: Update the user record
    if (isDryRun) {
      console.log('🔍 Step 2: DRY RUN - Would update user record...')
      console.log('   SQL: UPDATE "user" SET "stripe_customer_id" = $1 WHERE "id" = $2')
      console.log(`   Parameters: ['${STRIPE_CUSTOMER_ID}', '${USER_ID}']`)
      console.log()
      console.log('✅ DRY RUN COMPLETED - No changes made to database')
    } else {
      console.log('🔄 Step 2: Updating user record...')
      const result = await db
        .update(schema.user)
        .set({ stripeCustomerId: STRIPE_CUSTOMER_ID })
        .where(eq(schema.user.id, USER_ID))
        .returning()

      if (result.length === 0) {
        console.error('❌ Failed to update user record')
        await postgresClient.end()
        process.exit(1)
      }

      console.log('✅ User record updated successfully!')
      console.log(`   User: ${result[0].email}`)
      console.log(`   Stripe Customer ID: ${result[0].stripeCustomerId}`)
      console.log()

      // Step 4: Verify the update
      console.log('🔍 Step 3: Verifying update...')
      const verifyUsers = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, USER_ID))
        .limit(1)

      const verifiedUser = verifyUsers[0]
      if (verifiedUser.stripeCustomerId === STRIPE_CUSTOMER_ID) {
        console.log('✅ Update verified successfully!')
      } else {
        console.error('❌ Update verification failed')
        await postgresClient.end()
        process.exit(1)
      }
    }

    console.log()
    console.log('📋 Summary:')
    console.log(`   User ID: ${USER_ID}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   Name: ${user.name}`)
    console.log(`   Previous Stripe Customer ID: ${user.stripeCustomerId || 'None'}`)
    console.log(`   New Stripe Customer ID: ${STRIPE_CUSTOMER_ID}`)
    console.log(`   Status: ${isDryRun ? 'DRY RUN - NO CHANGES MADE' : 'COMPLETED SUCCESSFULLY'}`)
  } catch (error) {
    console.error('❌ Error occurred:', error)
    process.exit(1)
  } finally {
    await postgresClient.end()
  }
}

// Usage instructions
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Attach Stripe Customer to User Script')
  console.log('=====================================')
  console.log()
  console.log('Usage:')
  console.log('  DATABASE_URL="..." tsx scripts/attach-stripe-customer.ts [--dry-run]')
  console.log()
  console.log('Options:')
  console.log('  --dry-run    Show what would be changed without making actual changes')
  console.log('  --help, -h   Show this help message')
  console.log()
  console.log('Environment Variables:')
  console.log('  DATABASE_URL   PostgreSQL connection string (required)')
  console.log()
  console.log('Example:')
  console.log('  # Dry run first to see what will happen')
  console.log('  DATABASE_URL="postgresql://..." tsx scripts/attach-stripe-customer.ts --dry-run')
  console.log()
  console.log('  # Execute the actual update')
  console.log('  DATABASE_URL="postgresql://..." tsx scripts/attach-stripe-customer.ts')
  process.exit(0)
}

main().catch(console.error)
