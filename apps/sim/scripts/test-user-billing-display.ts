#!/usr/bin/env tsx

import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'
import { getSimplifiedBillingSummary } from '../lib/billing/core/billing'
import { getHighestPrioritySubscription } from '../lib/billing/core/subscription'

// Test Alex Young's user ID
const USER_ID = '7vBgXHU57ySMa47wIW8TKVW6rEJJu2Gl'

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required')
    process.exit(1)
  }

  console.log('🧪 Testing User Billing Display for Alex Young')
  console.log('==============================================')
  console.log(`User ID: ${USER_ID}`)
  console.log()

  // Initialize database connection
  const postgresClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })
  const db = drizzle(postgresClient, { schema })

  try {
    // Step 1: Replicate what getHighestPrioritySubscription does
    console.log('🔍 Step 1: Replicating getHighestPrioritySubscription logic...')

    // Get direct subscriptions (should be none now)
    const personalSubs = await db
      .select()
      .from(schema.subscription)
      .where(
        and(eq(schema.subscription.referenceId, USER_ID), eq(schema.subscription.status, 'active'))
      )

    console.log(`   Direct user subscriptions: ${personalSubs.length}`)
    personalSubs.forEach((sub, i) => {
      console.log(`     ${i + 1}. Plan: ${sub.plan}, Status: ${sub.status}`)
    })

    // Get organization memberships
    const memberships = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, USER_ID))

    console.log(`   Organization memberships: ${memberships.length}`)
    const orgIds = memberships.map((m) => m.organizationId)
    orgIds.forEach((orgId, i) => {
      console.log(`     ${i + 1}. Organization ID: ${orgId}`)
    })

    // Get organization subscriptions
    let orgSubs: any[] = []
    if (orgIds.length > 0) {
      orgSubs = await db
        .select()
        .from(schema.subscription)
        .where(
          and(
            inArray(schema.subscription.referenceId, orgIds),
            eq(schema.subscription.status, 'active')
          )
        )
    }

    console.log(`   Organization subscriptions: ${orgSubs.length}`)
    orgSubs.forEach((sub, i) => {
      console.log(
        `     ${i + 1}. Plan: ${sub.plan}, Status: ${sub.status}, Seats: ${sub.seats}, Ref: ${sub.referenceId}`
      )
    })

    // Step 2: Test the actual function
    console.log()
    console.log('🧪 Step 2: Testing getHighestPrioritySubscription function...')
    const subscription = await getHighestPrioritySubscription(USER_ID)

    if (!subscription) {
      console.log('❌ No subscription found!')
    } else {
      console.log('✅ Subscription found:')
      console.log(`   Plan: ${subscription.plan}`)
      console.log(`   Status: ${subscription.status}`)
      console.log(`   Seats: ${subscription.seats}`)
      console.log(`   Reference ID: ${subscription.referenceId}`)
      console.log(
        `   Stripe Subscription ID: ${subscription.stripeSubscriptionId || 'None (manual)'}`
      )
    }

    // Step 3: Test the billing summary (what the API returns)
    console.log()
    console.log('💳 Step 3: Testing getSimplifiedBillingSummary (API data)...')

    const billingData = await getSimplifiedBillingSummary(USER_ID)

    console.log('📊 Billing Summary Result:')
    console.log(`   Type: ${billingData.type}`)
    console.log(`   Plan: ${billingData.plan}`)
    console.log(`   isPaid: ${billingData.isPaid}`)
    console.log(`   isPro: ${billingData.isPro}`)
    console.log(`   isTeam: ${billingData.isTeam}`)
    console.log(`   isEnterprise: ${billingData.isEnterprise}`) // ⚠️ THIS IS KEY
    console.log(`   Status: ${billingData.status}`)
    console.log(`   Seats: ${billingData.seats}`)
    console.log()
    console.log('📈 Usage Data:')
    console.log(`   Current Usage: $${billingData.usage.current.toFixed(2)}`)
    console.log(`   Usage Limit: $${billingData.usage.limit}`)
    console.log(`   Percent Used: ${billingData.usage.percentUsed}%`)
    console.log(`   Is Warning (80%+): ${billingData.usage.isWarning}`)
    console.log(`   Is Exceeded: ${billingData.usage.isExceeded}`)
    console.log(`   Days Remaining: ${billingData.usage.daysRemaining}`)

    if (billingData.organizationData) {
      console.log()
      console.log('🏢 Organization Data:')
      console.log(`   Seat Count: ${billingData.organizationData.seatCount}`)
      console.log(`   Total Base Price: $${billingData.organizationData.totalBasePrice}`)
      console.log(
        `   Total Current Usage: $${billingData.organizationData.totalCurrentUsage.toFixed(2)}`
      )
      console.log(`   Total Overage: $${billingData.organizationData.totalOverage.toFixed(2)}`)
    }

    // Step 4: Simulate what the Usage Indicator will show
    console.log()
    console.log('🎨 Step 4: Usage Indicator Display Simulation...')
    console.log('===============================================')

    // Plan name mapping (from usage-indicator.tsx)
    const PLAN_NAMES = {
      enterprise: 'Enterprise',
      team: 'Team',
      pro: 'Pro',
      free: 'Free',
    } as const

    // Determine plan type (from usage-indicator.tsx logic)
    const planType = billingData.isEnterprise
      ? 'enterprise'
      : billingData.isTeam
        ? 'team'
        : billingData.isPro
          ? 'pro'
          : 'free'

    // Determine badge to show
    const showAddBadge = planType !== 'free' && billingData.usage.percentUsed >= 85
    const badgeText = planType === 'free' ? 'Upgrade' : 'Add'

    console.log()
    console.log('🖼️  USAGE INDICATOR WILL SHOW:')
    console.log('   ┌─────────────────────────────────┐')
    console.log(
      `   │ Plan: ${PLAN_NAMES[planType as keyof typeof PLAN_NAMES]}${showAddBadge ? ` [${badgeText}]` : ''}                │`
    )
    console.log(
      `   │ Usage: $${billingData.usage.current.toFixed(2)} / $${billingData.usage.limit}       │`
    )
    console.log(`   │ Progress: ${billingData.usage.percentUsed}% used              │`)
    console.log(`   │ Style: ${planType !== 'free' ? 'Gradient (paid)' : 'Regular'}        │`)
    console.log('   └─────────────────────────────────┘')
    console.log()

    // Final verdict
    console.log('🎯 FINAL VERDICT:')
    console.log('================')

    if (billingData.isEnterprise) {
      console.log('✅ SUCCESS: Alex will see "Enterprise" in the usage indicator!')
      console.log('✅ Plan will be styled with gradient (paid plan styling)')
      console.log(`✅ Usage limit: $${billingData.usage.limit}`)
      console.log(`✅ Current usage: $${billingData.usage.current.toFixed(2)}`)

      if (showAddBadge) {
        console.log('✅ "Add" badge will show (usage > 85%)')
      } else {
        console.log('ℹ️  No badge shown (usage < 85%)')
      }

      if (billingData.type === 'organization') {
        console.log(`✅ Organization-based billing (${billingData.seats} seats)`)
      }
    } else {
      console.log('❌ PROBLEM: Alex will NOT see Enterprise!')
      console.log(`❌ Plan detected as: ${billingData.plan}`)
      console.log('❌ Check subscription migration')
    }
  } catch (error) {
    console.error('❌ Error occurred:', error)
    process.exit(1)
  } finally {
    await postgresClient.end()
  }
}

main().catch(console.error)
