#!/usr/bin/env tsx

import { like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required')
    process.exit(1)
  }

  console.log('🔍 Querying Enterprise Subscriptions')
  console.log('===================================')
  console.log()

  // Initialize database connection
  const postgresClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })
  const db = drizzle(postgresClient, { schema })

  try {
    // Query all subscriptions with 'enterprise' in the plan name
    console.log('📋 Looking for subscriptions with "enterprise" plan...')
    const enterpriseSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(like(schema.subscription.plan, '%enterprise%'))
      .limit(10) // Limit to 10 examples

    if (enterpriseSubscriptions.length === 0) {
      console.log('ℹ️  No subscriptions found with "enterprise" in the plan name')
      console.log()

      // Let's also check what plans do exist
      console.log('📋 Let me show you what subscription plans exist in your database...')
      const allSubscriptions = await db
        .select({
          plan: schema.subscription.plan,
          status: schema.subscription.status,
          referenceId: schema.subscription.referenceId,
          createdAt: schema.subscription.createdAt,
          seats: schema.subscription.seats,
        })
        .from(schema.subscription)
        .limit(20) // Show first 20 subscriptions

      if (allSubscriptions.length === 0) {
        console.log('ℹ️  No subscriptions found in the database')
      } else {
        console.log(`Found ${allSubscriptions.length} subscription(s):`)
        console.log()

        // Group by plan to show what plans exist
        const planCounts = allSubscriptions.reduce(
          (acc, sub) => {
            acc[sub.plan] = (acc[sub.plan] || 0) + 1
            return acc
          },
          {} as Record<string, number>
        )

        console.log('📊 Plan distribution:')
        Object.entries(planCounts).forEach(([plan, count]) => {
          console.log(`   ${plan}: ${count} subscription(s)`)
        })
        console.log()

        console.log('📋 Sample subscriptions:')
        allSubscriptions.slice(0, 5).forEach((sub, index) => {
          console.log(`   ${index + 1}. Plan: ${sub.plan}`)
          console.log(`      Status: ${sub.status}`)
          console.log(`      Reference ID: ${sub.referenceId}`)
          console.log(`      Seats: ${sub.seats || 'N/A'}`)
          console.log(`      Created: ${sub.createdAt}`)
          console.log()
        })
      }
    } else {
      console.log(`✅ Found ${enterpriseSubscriptions.length} enterprise subscription(s):`)
      console.log()

      enterpriseSubscriptions.forEach((sub, index) => {
        console.log(`🏢 Enterprise Subscription #${index + 1}:`)
        console.log(`   ID: ${sub.id}`)
        console.log(`   Plan: ${sub.plan}`)
        console.log(`   Status: ${sub.status}`)
        console.log(`   Reference ID: ${sub.referenceId}`)
        console.log(`   Stripe Subscription ID: ${sub.stripeSubscriptionId || 'N/A'}`)
        console.log(`   Seats: ${sub.seats || 'N/A'}`)
        console.log(`   Created: ${sub.createdAt}`)
        console.log(`   Updated: ${sub.updatedAt}`)
        console.log()
      })
    }
  } catch (error) {
    console.error('❌ Error occurred:', error)
    process.exit(1)
  } finally {
    await postgresClient.end()
  }
}

// Usage instructions
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Query Enterprise Subscriptions Script')
  console.log('=====================================')
  console.log()
  console.log('Usage:')
  console.log('  DATABASE_URL="..." tsx scripts/query-enterprise-subscriptions.ts')
  console.log()
  console.log('Environment Variables:')
  console.log('  DATABASE_URL   PostgreSQL connection string (required)')
  process.exit(0)
}

main().catch(console.error)
