#!/usr/bin/env bun

/**
 * Pre-Migration Subscription Analysis Script
 *
 * This script analyzes existing subscription data to predict what the backfill
 * script will do WITHOUT requiring the new columns to exist yet.
 *
 * Use this to validate your backfill logic before applying the migration.
 */

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { member, organization, subscription, user, userStats } from '../db/schema'

interface SubscriptionAnalysis {
  id: string
  plan: string
  referenceId: string
  status: string | null
  seats: number | null
  metadata: any
  calculatedLimit: number
  entityType: 'user' | 'organization' | 'unknown'
  entityEmail?: string
  entityName?: string
  memberCount?: number
  userStatsExists: boolean
}

// Default usage limits by plan type (same as backfill script)
const PLAN_LIMITS = {
  free: 5,
  pro: 20,
  team: 40, // Per seat - will be multiplied by seats
  enterprise: 100, // Default for enterprise, can be overridden by metadata
} as const

function calculateUsageLimit(sub: any): number {
  const plan = sub.plan as keyof typeof PLAN_LIMITS

  switch (plan) {
    case 'free':
      return PLAN_LIMITS.free

    case 'pro':
      return PLAN_LIMITS.pro

    case 'team': {
      const seats = sub.seats || 1
      return PLAN_LIMITS.team * seats
    }

    case 'enterprise': {
      const metadata = sub.metadata
      if (metadata?.totalAllowance) {
        return Number(metadata.totalAllowance)
      }
      if (metadata?.perSeatAllowance && sub.seats) {
        return Number(metadata.perSeatAllowance) * sub.seats
      }
      return PLAN_LIMITS.enterprise
    }

    default:
      return PLAN_LIMITS.free
  }
}

async function analyzeSubscriptionData() {
  console.log('🔍 Analyzing subscription data for backfill planning...')
  console.log('⚠️  This script analyzes EXISTING data to predict backfill changes')
  console.log('📋 Safe to run before migration - only reads current schema\n')

  try {
    // Get all active subscriptions
    console.log('📊 Fetching subscription data...')
    const subscriptions = await db
      .select({
        id: subscription.id,
        plan: subscription.plan,
        referenceId: subscription.referenceId,
        status: subscription.status,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        seats: subscription.seats,
        metadata: subscription.metadata,
      })
      .from(subscription)
      .where(eq(subscription.status, 'active'))

    console.log(`📈 Found ${subscriptions.length} active subscriptions\n`)

    const analysis: SubscriptionAnalysis[] = []
    let userSubscriptions = 0
    let orgSubscriptions = 0
    let unknownSubscriptions = 0
    let totalNewRecords = 0
    let totalUpdates = 0

    for (const sub of subscriptions) {
      console.log(`🔄 Analyzing subscription ${sub.id} (${sub.plan})...`)

      const calculatedLimit = calculateUsageLimit(sub)

      // Check if referenceId is a user
      const userData = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, sub.referenceId))
        .limit(1)

      let entityType: 'user' | 'organization' | 'unknown' = 'unknown'
      let entityEmail: string | undefined
      let entityName: string | undefined
      let memberCount: number | undefined

      if (userData.length > 0) {
        entityType = 'user'
        entityEmail = userData[0].email
        userSubscriptions++

        // Check if user has existing userStats
        const existingStats = await db
          .select({ id: userStats.id })
          .from(userStats)
          .where(eq(userStats.userId, userData[0].id))
          .limit(1)

        const userStatsExists = existingStats.length > 0

        if (userStatsExists) {
          totalUpdates++
        } else {
          totalNewRecords++
        }

        analysis.push({
          id: sub.id,
          plan: sub.plan,
          referenceId: sub.referenceId,
          status: sub.status,
          seats: sub.seats,
          metadata: sub.metadata,
          calculatedLimit,
          entityType,
          entityEmail,
          userStatsExists,
        })

        console.log(`  👤 User: ${entityEmail}`)
        console.log(`  💰 Calculated limit: $${calculatedLimit}`)
        console.log(
          `  📊 UserStats: ${userStatsExists ? 'EXISTS (will update)' : 'MISSING (will create)'}`
        )
      } else {
        // Check if it's an organization
        const orgData = await db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(eq(organization.id, sub.referenceId))
          .limit(1)

        if (orgData.length > 0) {
          entityType = 'organization'
          entityName = orgData[0].name
          orgSubscriptions++

          // Get organization members
          const members = await db
            .select({
              userId: member.userId,
              userEmail: user.email,
            })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .where(eq(member.organizationId, orgData[0].id))

          memberCount = members.length

          // Check userStats for each member
          let existingMemberStats = 0
          let missingMemberStats = 0

          for (const memberData of members) {
            const existingStats = await db
              .select()
              .from(userStats)
              .where(eq(userStats.userId, memberData.userId))
              .limit(1)

            if (existingStats.length > 0) {
              existingMemberStats++
              totalUpdates++
            } else {
              missingMemberStats++
              totalNewRecords++
            }
          }

          analysis.push({
            id: sub.id,
            plan: sub.plan,
            referenceId: sub.referenceId,
            status: sub.status,
            seats: sub.seats,
            metadata: sub.metadata,
            calculatedLimit,
            entityType,
            entityName,
            memberCount,
            userStatsExists: false, // N/A for orgs
          })

          console.log(`  🏢 Organization: ${entityName}`)
          console.log(`  👥 Members: ${memberCount}`)
          console.log(`  💰 Per-user limit: $${calculatedLimit}`)
          console.log(`  📊 UserStats: ${existingMemberStats} exist, ${missingMemberStats} missing`)
        } else {
          unknownSubscriptions++
          console.log(`  ⚠️  Unknown entity type for referenceId: ${sub.referenceId}`)
        }
      }

      console.log('') // Empty line for readability
    }

    // Summary
    console.log('🎉 Analysis Complete!\n')

    console.log('📊 Subscription Breakdown:')
    console.log(`  👤 User subscriptions: ${userSubscriptions}`)
    console.log(`  🏢 Organization subscriptions: ${orgSubscriptions}`)
    console.log(`  ❓ Unknown reference IDs: ${unknownSubscriptions}`)

    console.log('\n📋 Plan Distribution:')
    const planCounts = analysis.reduce(
      (acc, sub) => {
        acc[sub.plan] = (acc[sub.plan] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    Object.entries(planCounts).forEach(([plan, count]) => {
      console.log(`  ${plan}: ${count} subscriptions`)
    })

    console.log('\n💰 Limit Changes Needed:')
    console.log(`  ✨ New userStats records to create: ${totalNewRecords}`)
    console.log(`  🔄 Existing userStats records to update: ${totalUpdates}`)
    console.log(`  🎯 Total database operations planned: ${totalNewRecords + totalUpdates}`)
    console.log("\n📝 Note: Current usage limits not shown (columns don't exist yet)")
    console.log('    After migration, backfill will set these calculated limits')

    console.log('\n⚠️  Potential Issues:')
    if (unknownSubscriptions > 0) {
      console.log(`  🚨 ${unknownSubscriptions} subscriptions have unknown reference IDs`)
    }

    const enterpriseWithoutMetadata = analysis.filter(
      (sub) =>
        sub.plan === 'enterprise' &&
        !sub.metadata?.totalAllowance &&
        !sub.metadata?.perSeatAllowance
    )

    if (enterpriseWithoutMetadata.length > 0) {
      console.log(
        `  ⚠️  ${enterpriseWithoutMetadata.length} enterprise subscriptions using default $100 limit`
      )
    }

    console.log('\n✅ Next Steps:')
    console.log('  1. Review the analysis above for any unexpected results')
    console.log('  2. Apply database migration: bun run db:migrate')
    console.log('  3. Run backfill dry run: bun run db:backfill:dry-run')
    console.log('  4. Deploy application code')
    console.log('  5. Execute backfill: bun run db:backfill')

    return analysis
  } catch (error) {
    console.error('💥 Error during analysis:', error)
    process.exit(1)
  }
}

// Run the analysis if this script is executed directly
if (require.main === module) {
  analyzeSubscriptionData()
    .then(() => {
      console.log('\n🏁 Analysis completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 Script failed:', error)
      process.exit(1)
    })
}

export { analyzeSubscriptionData }
