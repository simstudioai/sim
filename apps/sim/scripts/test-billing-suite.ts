import { config } from 'dotenv'
import { eq, like } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { processDailyBillingCheck } from '@/lib/billing/core/billing'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { member, organization, subscription, user, userStats } from '@/db/schema'

// Load environment variables
config()

const logger = createLogger('BillingTestSuite')

interface TestUser {
  id: string
  email: string
  stripeCustomerId: string
  plan: string
  usage: number
  overage: number
}

interface TestOrg {
  id: string
  name: string
  stripeCustomerId: string
  plan: string
  seats: number
  memberCount: number
  totalUsage: number
  overage: number
}

interface TestResults {
  users: TestUser[]
  organizations: TestOrg[]
  billingResults: any
}

/**
 * Comprehensive billing test suite
 * Run with: bun run test:billing:suite
 */
async function runBillingTestSuite(): Promise<TestResults> {
  logger.info('🚀 Starting comprehensive billing test suite...')

  const results: TestResults = {
    users: [],
    organizations: [],
    billingResults: null,
  }

  try {
    // 1. Create test users for each scenario
    logger.info('\n📋 Creating test users...')

    // Free user (no overage billing)
    const freeUser = await createTestUser('free', 5) // $5 usage on free plan
    results.users.push(freeUser)

    // Pro user with no overage
    const proUserNoOverage = await createTestUser('pro', 15) // $15 usage < $20 base
    results.users.push(proUserNoOverage)

    // Pro user with overage
    const proUserWithOverage = await createTestUser('pro', 35) // $35 usage > $20 base = $15 overage
    results.users.push(proUserWithOverage)

    // Pro user with high overage
    const proUserHighOverage = await createTestUser('pro', 100) // $100 usage = $80 overage
    results.users.push(proUserHighOverage)

    // 2. Create test organizations
    logger.info('\n🏢 Creating test organizations...')

    // Team with no overage (2 seats, 3 members, low usage)
    const teamNoOverage = await createTestOrganization('team', 2, 3, 150) // 3 members, $150 total < $200 base (2 seats × $100)
    results.organizations.push(teamNoOverage)

    // Team with overage (2 seats, 3 members, high usage)
    const teamWithOverage = await createTestOrganization('team', 2, 3, 350) // 3 members, $350 total > $200 base = $150 overage
    results.organizations.push(teamWithOverage)

    // Enterprise with overage (5 seats, 8 members, high usage)
    const enterpriseWithOverage = await createTestOrganization('enterprise', 5, 8, 2000) // 8 members, $2000 total > $1500 base (5 seats × $300) = $500 overage
    results.organizations.push(enterpriseWithOverage)

    // 3. Display test data summary
    logger.info('\n📊 Test Data Summary:')
    logger.info('===================')

    logger.info('\n👤 Individual Users:')
    for (const user of results.users) {
      logger.info(`  ${user.plan.toUpperCase()} - ${user.email}`)
      logger.info(`    Usage: $${user.usage} | Overage: $${user.overage}`)
      logger.info(`    Customer: ${user.stripeCustomerId}`)
    }

    logger.info('\n🏢 Organizations:')
    for (const org of results.organizations) {
      logger.info(`  ${org.plan.toUpperCase()} - ${org.name}`)
      logger.info(
        `    Seats: ${org.seats} | Members: ${org.memberCount} | Usage: $${org.totalUsage} | Overage: $${org.overage}`
      )
      logger.info(`    Customer: ${org.stripeCustomerId}`)
    }

    // 4. Wait for user confirmation
    logger.info('\n⏸️  Test data created. Ready to run billing CRON?')
    logger.info('   Press Ctrl+C to cancel, or wait 5 seconds to continue...')
    await sleep(5000)

    // 5. Run the daily billing CRON
    logger.info('\n🔄 Running daily billing CRON...')
    const billingResult = await processDailyBillingCheck()
    results.billingResults = billingResult

    // 6. Display billing results
    logger.info('\n💰 Billing Results:')
    logger.info('==================')
    logger.info(`✅ Success: ${billingResult.success}`)
    logger.info(`👤 Users processed: ${billingResult.processedUsers}`)
    logger.info(`🏢 Organizations processed: ${billingResult.processedOrganizations}`)
    logger.info(`💵 Total charged: $${billingResult.totalChargedAmount}`)

    if (billingResult.errors.length > 0) {
      logger.error('❌ Errors:', billingResult.errors)
    }

    // 7. Verify results in Stripe
    logger.info('\n🔍 Verifying in Stripe...')
    await verifyStripeResults(results)

    logger.info('\n✅ Test suite completed successfully!')
    logger.info('\n📝 Next steps:')
    logger.info('1. Check your Stripe Dashboard for invoices')
    logger.info('2. Monitor webhook events in your listener')
    logger.info('3. Check for email notifications (if in live mode)')

    return results
  } catch (error) {
    logger.error('Test suite failed', { error })
    throw error
  }
}

async function createTestUser(plan: 'free' | 'pro', usageAmount: number): Promise<TestUser> {
  const stripe = requireStripeClient()
  const userId = nanoid()
  const email = `test-${plan}-${Date.now()}@example.com`

  // Create Stripe customer
  const stripeCustomer = await stripe.customers.create({
    email,
    metadata: {
      userId,
      testUser: 'true',
      plan,
    },
  })

  // Add payment method
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  })

  await stripe.paymentMethods.attach(paymentMethod.id, {
    customer: stripeCustomer.id,
  })

  await stripe.customers.update(stripeCustomer.id, {
    invoice_settings: {
      default_payment_method: paymentMethod.id,
    },
  })

  // Create user in database
  await db.insert(user).values({
    id: userId,
    email,
    name: `Test ${plan.toUpperCase()} User`,
    stripeCustomerId: stripeCustomer.id,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Create subscription
  const periodEnd = new Date()
  periodEnd.setUTCHours(23, 59, 59, 999) // End of today

  await db.insert(subscription).values({
    id: nanoid(),
    plan,
    referenceId: userId,
    stripeCustomerId: stripeCustomer.id,
    stripeSubscriptionId: `sub_test_${nanoid()}`,
    status: 'active',
    periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    periodEnd,
    seats: 1,
  })

  // Create user stats
  await db.insert(userStats).values({
    id: nanoid(),
    userId,
    currentPeriodCost: usageAmount.toString(),
    billingPeriodEnd: periodEnd,
    currentUsageLimit: (usageAmount + 10).toString(), // Some headroom
  })

  const basePrice = plan === 'pro' ? 20 : 0
  const overage = Math.max(0, usageAmount - basePrice)

  logger.info(`✅ Created ${plan} user`, {
    email,
    usage: `$${usageAmount}`,
    overage: `$${overage}`,
  })

  return {
    id: userId,
    email,
    stripeCustomerId: stripeCustomer.id,
    plan,
    usage: usageAmount,
    overage,
  }
}

async function createTestOrganization(
  plan: 'team' | 'enterprise',
  seats: number,
  memberCount: number,
  totalUsage: number
): Promise<TestOrg> {
  const stripe = requireStripeClient()
  const orgId = nanoid()
  const orgName = `Test ${plan.toUpperCase()} Org ${Date.now()}`

  // Create Stripe customer for org FIRST
  const stripeCustomer = await stripe.customers.create({
    email: `billing-${orgId}@example.com`,
    name: orgName,
    metadata: {
      organizationId: orgId,
      testOrg: 'true',
      plan,
    },
  })

  // Add payment method
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: { token: 'tok_visa' },
  })

  await stripe.paymentMethods.attach(paymentMethod.id, {
    customer: stripeCustomer.id,
  })

  await stripe.customers.update(stripeCustomer.id, {
    invoice_settings: {
      default_payment_method: paymentMethod.id,
    },
  })

  // Create organization in DB with Stripe customer ID in metadata
  await db.insert(organization).values({
    id: orgId,
    name: orgName,
    slug: `test-${plan}-org-${Date.now()}`,
    metadata: { stripeCustomerId: stripeCustomer.id }, // Store Stripe customer ID in metadata
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Create subscription
  const periodEnd = new Date()
  periodEnd.setUTCHours(23, 59, 59, 999) // End of today

  // Add metadata for enterprise plans
  const metadata =
    plan === 'enterprise'
      ? { perSeatAllowance: 500, totalAllowance: 5000 } // Enterprise gets $500 per seat or $5000 total
      : {}

  await db.insert(subscription).values({
    id: nanoid(),
    plan,
    referenceId: orgId,
    stripeCustomerId: stripeCustomer.id,
    stripeSubscriptionId: `sub_test_${nanoid()}`,
    status: 'active',
    periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    periodEnd,
    seats,
    metadata,
  })

  // Create members with usage
  const usagePerMember = Math.floor(totalUsage / memberCount)
  for (let i = 0; i < memberCount; i++) {
    const memberId = nanoid()
    const isOwner = i === 0

    // Create user
    await db.insert(user).values({
      id: memberId,
      email: `member-${i + 1}-${orgId}@example.com`,
      name: `Member ${i + 1}`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Add to organization
    await db.insert(member).values({
      id: nanoid(),
      userId: memberId,
      organizationId: orgId,
      role: isOwner ? 'owner' : 'member',
      createdAt: new Date(),
    })

    // Create user stats
    await db.insert(userStats).values({
      id: nanoid(),
      userId: memberId,
      currentPeriodCost: usagePerMember.toString(),
      billingPeriodEnd: periodEnd,
      currentUsageLimit: (usagePerMember + 50).toString(),
    })
  }

  const basePricePerSeat = plan === 'team' ? 100 : 300
  const baseTotal = seats * basePricePerSeat
  const overage = Math.max(0, totalUsage - baseTotal)

  logger.info(`✅ Created ${plan} organization`, {
    name: orgName,
    seats,
    members: memberCount,
    usage: `$${totalUsage}`,
    overage: `$${overage}`,
  })

  return {
    id: orgId,
    name: orgName,
    stripeCustomerId: stripeCustomer.id,
    plan,
    seats,
    memberCount,
    totalUsage,
    overage,
  }
}

async function verifyStripeResults(results: TestResults) {
  const stripe = requireStripeClient()

  logger.info('\n📋 Stripe Verification:')

  // Check for recent invoices
  const recentInvoices = await stripe.invoices.list({
    limit: 20,
    created: {
      gte: Math.floor(Date.now() / 1000) - 300, // Last 5 minutes
    },
  })

  const testInvoices = recentInvoices.data.filter((inv) => inv.metadata?.type === 'overage_billing')

  logger.info(`Found ${testInvoices.length} overage invoices created`)

  for (const invoice of testInvoices) {
    const customerType = invoice.metadata?.organizationId ? 'Organization' : 'User'
    logger.info(`  ${customerType} Invoice: ${invoice.number || invoice.id}`)
    logger.info(`    Amount: $${invoice.amount_due / 100}`)
    logger.info(`    Status: ${invoice.status}`)
    logger.info(`    Customer: ${invoice.customer}`)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Cleanup function
async function cleanupTestData() {
  logger.info('\n🧹 Cleaning up test data...')

  try {
    // Find all test users
    const testUsers = await db.select().from(user).where(like(user.email, 'test-%'))

    // Find all test organizations
    const testOrgs = await db.select().from(organization).where(like(organization.name, 'Test %'))

    logger.info(
      `Found ${testUsers.length} test users and ${testOrgs.length} test organizations to clean up`
    )

    // Clean up users
    for (const testUser of testUsers) {
      await db.delete(userStats).where(eq(userStats.userId, testUser.id))
      await db.delete(member).where(eq(member.userId, testUser.id))
      await db.delete(subscription).where(eq(subscription.referenceId, testUser.id))
      await db.delete(user).where(eq(user.id, testUser.id))
    }

    // Clean up organizations
    for (const org of testOrgs) {
      await db.delete(member).where(eq(member.organizationId, org.id))
      await db.delete(subscription).where(eq(subscription.referenceId, org.id))
      await db.delete(organization).where(eq(organization.id, org.id))
    }

    logger.info('✅ Cleanup completed')
  } catch (error) {
    logger.error('Cleanup failed', { error })
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--cleanup')) {
    await cleanupTestData()
    return
  }

  if (args.includes('--help')) {
    logger.info('Billing Test Suite')
    logger.info('==================')
    logger.info('Usage: bun run test:billing:suite [options]')
    logger.info('')
    logger.info('Options:')
    logger.info('  --cleanup    Clean up all test data')
    logger.info('  --help       Show this help message')
    logger.info('')
    logger.info('This script will:')
    logger.info('1. Create test users (free, pro with/without overage)')
    logger.info('2. Create test organizations (team, enterprise)')
    logger.info('3. Run the daily billing CRON')
    logger.info('4. Verify results in Stripe')
    return
  }

  await runBillingTestSuite()
}

// Run the suite
main().catch((error) => {
  logger.error('Test suite failed', { error })
  process.exit(1)
})
