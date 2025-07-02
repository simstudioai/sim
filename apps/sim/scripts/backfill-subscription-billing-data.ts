#!/usr/bin/env bun

/**
 * Backfill script for initializing billing data for existing subscription holders
 *
 * This script handles:
 * 1. Setting appropriate usage limits based on subscription plans
 * 2. Initializing billing periods from existing subscription data
 * 3. Creating userStats records for users who don't have them
 * 4. Handling different subscription statuses and types
 *
 * Usage:
 *   bun run scripts/backfill-subscription-billing-data.ts           # Run actual backfill
 *   bun run scripts/backfill-subscription-billing-data.ts --dry-run # Dry run mode (no changes)
 */

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { member, organization, subscription, user, userStats } from '../db/schema'

interface SubscriptionWithUser {
  id: string
  plan: string
  referenceId: string
  status: string | null
  periodStart: Date | null
  periodEnd: Date | null
  seats: number | null
  metadata: any
  user?: {
    id: string
    email: string
  }
  organization?: {
    id: string
    name: string
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run') || args.includes('-n')

// Default usage limits by plan type
const PLAN_LIMITS = {
  free: 5,
  pro: 20,
  team: 40, // Per seat - will be multiplied by seats
  enterprise: 100, // Default for enterprise, can be overridden by metadata
} as const

function logDryRun(message: string) {
  if (isDryRun) {
    console.log(`[DRY RUN] ${message}`)
  } else {
    console.log(message)
  }
}

function logAction(action: string, wouldDo: boolean = isDryRun) {
  const prefix = wouldDo ? '[DRY RUN - WOULD]' : '[EXECUTING]'
  console.log(`${prefix} ${action}`)
}

async function getDefaultUsageLimit(subscription: SubscriptionWithUser): Promise<number> {
  const plan = subscription.plan as keyof typeof PLAN_LIMITS

  switch (plan) {
    case 'free':
      return PLAN_LIMITS.free

    case 'pro':
      return PLAN_LIMITS.pro

    case 'team': {
      // For team plans, multiply by number of seats
      const seats = subscription.seats || 1
      return PLAN_LIMITS.team * seats
    }

    case 'enterprise': {
      // Check metadata for custom limits
      const metadata = subscription.metadata
      if (metadata?.totalAllowance) {
        return Number(metadata.totalAllowance)
      }
      if (metadata?.perSeatAllowance && subscription.seats) {
        return Number(metadata.perSeatAllowance) * subscription.seats
      }
      return PLAN_LIMITS.enterprise
    }

    default:
      console.warn(`Unknown plan type: ${plan}, defaulting to free plan limit`)
      return PLAN_LIMITS.free
  }
}

async function calculateBillingPeriod(subscription: SubscriptionWithUser) {
  const now = new Date()

  // If subscription has period dates, use them
  if (subscription.periodStart && subscription.periodEnd) {
    return {
      start: subscription.periodStart,
      end: subscription.periodEnd,
    }
  }

  // If only period start, calculate monthly period
  if (subscription.periodStart) {
    const start = new Date(subscription.periodStart)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    return { start, end }
  }

  // Fallback: start from now, monthly period
  const start = now
  const end = new Date(now)
  end.setMonth(end.getMonth() + 1)

  return { start, end }
}

async function backfillSubscriptionBillingData() {
  const mode = isDryRun ? '🔍 DRY RUN MODE' : '🚀 LIVE MODE'
  console.log(`${mode} - Starting subscription billing data backfill...`)

  if (isDryRun) {
    console.log('⚠️  This is a DRY RUN - no actual changes will be made to the database')
    console.log('📝 All operations will be logged to show what WOULD happen\n')
  }

  try {
    // Get all active subscriptions with user and organization data
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

    console.log(`📈 Found ${subscriptions.length} active subscriptions`)

    let processedCount = 0
    let skippedCount = 0
    let errorCount = 0
    let recordsToCreate = 0
    let recordsToUpdate = 0

    for (const sub of subscriptions) {
      try {
        logDryRun(`\n🔄 Processing subscription ${sub.id} (${sub.plan})...`)

        // Determine if this is a user or organization subscription
        let userId: string | null = null
        let organizationId: string | null = null

        // Try to find user first
        const userData = await db
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, sub.referenceId))
          .limit(1)

        if (userData.length > 0) {
          userId = userData[0].id
          logDryRun(`  👤 User subscription for: ${userData[0].email}`)
        } else {
          // Try to find organization
          const orgData = await db
            .select({ id: organization.id, name: organization.name })
            .from(organization)
            .where(eq(organization.id, sub.referenceId))
            .limit(1)

          if (orgData.length > 0) {
            organizationId = orgData[0].id
            logDryRun(`  🏢 Organization subscription for: ${orgData[0].name}`)
          } else {
            console.warn(
              `  ⚠️  Could not find user or organization for referenceId: ${sub.referenceId}`
            )
            skippedCount++
            continue
          }
        }

        // Calculate usage limit and billing periods
        const usageLimit = await getDefaultUsageLimit(sub as SubscriptionWithUser)
        const billingPeriod = await calculateBillingPeriod(sub as SubscriptionWithUser)

        logDryRun(`  💰 Usage limit: $${usageLimit}`)
        logDryRun(
          `  📅 Billing period: ${billingPeriod.start.toISOString()} - ${billingPeriod.end.toISOString()}`
        )

        if (userId) {
          // Handle user subscription
          const stats = await handleUserSubscription(userId, usageLimit, billingPeriod)
          if (stats.created) recordsToCreate++
          if (stats.updated) recordsToUpdate++
        } else if (organizationId) {
          // Handle organization subscription - update all members
          const stats = await handleOrganizationSubscription(
            organizationId,
            usageLimit,
            billingPeriod
          )
          recordsToCreate += stats.created
          recordsToUpdate += stats.updated
        }

        processedCount++
        logDryRun(`  ✅ Processed successfully`)
      } catch (error) {
        errorCount++
        console.error(`  ❌ Error processing subscription ${sub.id}:`, error)
      }
    }

    console.log(`\n🎉 Backfill analysis completed!`)
    console.log(`  📊 Total subscriptions found: ${subscriptions.length}`)
    console.log(`  ✅ Successfully processed: ${processedCount}`)
    console.log(`  ⏭️  Skipped (no user/org found): ${skippedCount}`)
    console.log(`  ❌ Errors: ${errorCount}`)

    if (isDryRun) {
      console.log(`\n📝 Summary of changes that WOULD be made:`)
      console.log(`  ✨ New userStats records to create: ${recordsToCreate}`)
      console.log(`  🔄 Existing userStats records to update: ${recordsToUpdate}`)
      console.log(`  🎯 Total database operations: ${recordsToCreate + recordsToUpdate}`)
      console.log(`\n💡 To apply these changes, run the script without --dry-run`)
    } else {
      console.log(`\n✅ Applied changes:`)
      console.log(`  ✨ New userStats records created: ${recordsToCreate}`)
      console.log(`  🔄 Existing userStats records updated: ${recordsToUpdate}`)
      console.log(`  🎯 Total database operations: ${recordsToCreate + recordsToUpdate}`)
    }
  } catch (error) {
    console.error('💥 Fatal error during backfill:', error)
    process.exit(1)
  }
}

async function handleUserSubscription(
  userId: string,
  usageLimit: number,
  billingPeriod: { start: Date; end: Date }
): Promise<{ created: number; updated: number }> {
  // Check if user already has userStats
  const existingStats = await db
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (existingStats.length > 0) {
    // Update existing record
    const existingRecord = existingStats[0]
    logAction(`Update userStats for user ${userId}:`)
    logDryRun(
      `      📊 Current limit: $${existingRecord.currentUsageLimit} → New limit: $${usageLimit}`
    )
    logDryRun(
      `      📅 Current billing start: ${existingRecord.billingPeriodStart || 'null'} → New: ${billingPeriod.start.toISOString()}`
    )
    logDryRun(
      `      📅 Current billing end: ${existingRecord.billingPeriodEnd || 'null'} → New: ${billingPeriod.end.toISOString()}`
    )

    if (!isDryRun) {
      await db
        .update(userStats)
        .set({
          currentUsageLimit: usageLimit.toString(),
          billingPeriodStart: billingPeriod.start,
          billingPeriodEnd: billingPeriod.end,
          usageLimitUpdatedAt: new Date(),
        })
        .where(eq(userStats.userId, userId))
    }

    logDryRun(`    🔄 ${isDryRun ? 'Would update' : 'Updated'} existing userStats`)
    return { created: 0, updated: 1 }
  }
  // Create new record
  logAction(`Create new userStats record for user ${userId}:`)
  logDryRun(`      💰 Usage limit: $${usageLimit}`)
  logDryRun(
    `      📅 Billing period: ${billingPeriod.start.toISOString()} - ${billingPeriod.end.toISOString()}`
  )

  if (!isDryRun) {
    await db.insert(userStats).values({
      id: userId, // Use userId as primary key
      userId,
      currentUsageLimit: usageLimit.toString(),
      billingPeriodStart: billingPeriod.start,
      billingPeriodEnd: billingPeriod.end,
      usageLimitUpdatedAt: new Date(),
      // All other fields will use their defaults
    })
  }

  logDryRun(`    ✨ ${isDryRun ? 'Would create' : 'Created'} new userStats record`)
  return { created: 1, updated: 0 }
}

async function handleOrganizationSubscription(
  organizationId: string,
  usageLimit: number,
  billingPeriod: { start: Date; end: Date }
): Promise<{ created: number; updated: number }> {
  // Get all members of the organization
  const members = await db
    .select({
      userId: member.userId,
      userEmail: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId))

  logDryRun(`    👥 Found ${members.length} organization members`)

  let created = 0
  let updated = 0

  for (const memberData of members) {
    try {
      // Check if user already has userStats
      const existingStats = await db
        .select()
        .from(userStats)
        .where(eq(userStats.userId, memberData.userId))
        .limit(1)

      if (existingStats.length > 0) {
        // Update existing record
        const existingRecord = existingStats[0]
        logAction(`Update userStats for member ${memberData.userEmail}:`)
        logDryRun(
          `        📊 Current limit: $${existingRecord.currentUsageLimit} → New limit: $${usageLimit}`
        )
        logDryRun(
          `        📅 Current billing period: ${existingRecord.billingPeriodStart || 'null'} - ${existingRecord.billingPeriodEnd || 'null'}`
        )
        logDryRun(
          `        📅 New billing period: ${billingPeriod.start.toISOString()} - ${billingPeriod.end.toISOString()}`
        )

        if (!isDryRun) {
          await db
            .update(userStats)
            .set({
              currentUsageLimit: usageLimit.toString(),
              billingPeriodStart: billingPeriod.start,
              billingPeriodEnd: billingPeriod.end,
              usageLimitUpdatedAt: new Date(),
            })
            .where(eq(userStats.userId, memberData.userId))
        }

        logDryRun(
          `      🔄 ${isDryRun ? 'Would update' : 'Updated'} userStats for ${memberData.userEmail}`
        )
        updated++
      } else {
        // Create new record
        logAction(`Create userStats for member ${memberData.userEmail}:`)
        logDryRun(`        💰 Usage limit: $${usageLimit}`)
        logDryRun(
          `        📅 Billing period: ${billingPeriod.start.toISOString()} - ${billingPeriod.end.toISOString()}`
        )

        if (!isDryRun) {
          await db.insert(userStats).values({
            id: memberData.userId, // Use userId as primary key
            userId: memberData.userId,
            currentUsageLimit: usageLimit.toString(),
            billingPeriodStart: billingPeriod.start,
            billingPeriodEnd: billingPeriod.end,
            usageLimitUpdatedAt: new Date(),
            // All other fields will use their defaults
          })
        }

        logDryRun(
          `      ✨ ${isDryRun ? 'Would create' : 'Created'} userStats for ${memberData.userEmail}`
        )
        created++
      }
    } catch (error) {
      console.error(
        `      ❌ Error ${isDryRun ? 'analyzing' : 'updating'} member ${memberData.userEmail}:`,
        error
      )
    }
  }

  return { created, updated }
}

// Run the backfill if this script is executed directly
if (require.main === module) {
  backfillSubscriptionBillingData()
    .then(() => {
      const mode = isDryRun ? 'DRY RUN analysis' : 'backfill execution'
      console.log(`🏁 ${mode} completed successfully`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 Script failed:', error)
      process.exit(1)
    })
}

export { backfillSubscriptionBillingData }
