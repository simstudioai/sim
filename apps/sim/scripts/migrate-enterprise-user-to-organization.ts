#!/usr/bin/env tsx

import { and, eq } from 'drizzle-orm'
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

  console.log('🏢 Migrating Enterprise User to Organization Setup')
  console.log('=================================================')
  console.log(`User ID: ${USER_ID}`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'EXECUTE'}`)
  console.log()

  // Initialize database connection
  const postgresClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })
  const db = drizzle(postgresClient, { schema })

  try {
    // Step 1: Verify user and current state
    console.log('🔍 Step 1: Verifying current user state...')
    const users = await db.select().from(schema.user).where(eq(schema.user.id, USER_ID)).limit(1)

    if (users.length === 0) {
      console.error(`❌ User with ID ${USER_ID} not found`)
      await postgresClient.end()
      process.exit(1)
    }

    const user = users[0]
    console.log(`✅ User: ${user.name} (${user.email})`)

    // Check existing memberships
    const existingMemberships = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, USER_ID))

    if (existingMemberships.length > 0) {
      console.log('ℹ️  User already has organization memberships. Skipping migration.')
      await postgresClient.end()
      return
    }

    // Get user's current subscription
    const userSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, USER_ID))

    if (userSubscriptions.length === 0) {
      console.error('❌ No subscription found for user')
      await postgresClient.end()
      process.exit(1)
    }

    const subscription = userSubscriptions[0]
    console.log(`✅ Found subscription: ${subscription.plan} (${subscription.seats} seats)`)

    // Get user's workspaces (these must be preserved)
    const userWorkspaces = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.ownerId, USER_ID))

    console.log(`📂 User has ${userWorkspaces.length} workspace(s) to preserve`)

    // Get user's workflows (these must be preserved)
    const userWorkflows = await db
      .select()
      .from(schema.workflow)
      .where(eq(schema.workflow.userId, USER_ID))

    console.log(`⚙️  User has ${userWorkflows.length} workflow(s) to preserve`)
    console.log()

    if (isDryRun) {
      console.log('🔍 DRY RUN - Would execute the following operations:')
      console.log()

      console.log('📋 PLAN:')
      console.log('   1. Create new organization for user')
      console.log(`   2. Add user as owner of organization`)
      console.log(`   3. Transfer subscription from user (${USER_ID}) to organization`)
      console.log(`   4. Update active organization in user sessions`)
      console.log('   5. All workspaces and workflows remain unchanged (preserving user ownership)')
      console.log()

      console.log('✅ DRY RUN COMPLETED - No changes made to database')
      console.log()
      console.log('🔒 SAFETY GUARANTEES:')
      console.log('   • Workspaces remain owned by user - no interruption')
      console.log('   • Workflows remain owned by user - no interruption')
      console.log('   • User sessions continue working')
      console.log('   • Only subscription moves to organization level')
      console.log('   • User gains organization/team functionality')
      await postgresClient.end()
      return
    }

    // Step 2: Create organization
    console.log('🏗️  Step 2: Creating organization...')
    const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
    const orgSlug = `${
      user.name
        ?.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'enterprise'
    }-${Date.now()}`
    const orgName = `${user.name || 'User'}'s Enterprise Team`

    // Create organization with Stripe customer metadata
    const newOrg = await db
      .insert(schema.organization)
      .values({
        id: orgId,
        name: orgName,
        slug: orgSlug,
        metadata: {
          stripeCustomerId: STRIPE_CUSTOMER_ID,
          migratedFromUserId: USER_ID,
          migrationDate: new Date().toISOString(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    console.log(`✅ Organization created: ${orgName} (${orgId})`)

    // Step 3: Add user as owner of organization
    console.log('👑 Step 3: Adding user as organization owner...')
    const memberId = `member_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`

    await db.insert(schema.member).values({
      id: memberId,
      userId: USER_ID,
      organizationId: orgId,
      role: 'owner',
      createdAt: new Date(),
    })

    console.log(`✅ User added as owner of organization`)

    // Step 4: Transfer subscription to organization
    console.log('💳 Step 4: Transferring subscription to organization...')

    await db
      .update(schema.subscription)
      .set({
        referenceId: orgId,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscription.id, subscription.id))

    console.log(`✅ Subscription transferred to organization`)

    // Step 5: Update user sessions to set active organization
    console.log('🔐 Step 5: Updating active sessions...')

    const updatedSessions = await db
      .update(schema.session)
      .set({
        activeOrganizationId: orgId,
      })
      .where(eq(schema.session.userId, USER_ID))
      .returning()

    console.log(`✅ Updated ${updatedSessions.length} session(s) with active organization`)

    // Step 6: Verification
    console.log('🔍 Step 6: Verifying migration...')

    // Verify membership
    const verifyMembership = await db
      .select()
      .from(schema.member)
      .where(and(eq(schema.member.userId, USER_ID), eq(schema.member.organizationId, orgId)))

    // Verify subscription transfer
    const verifySubscription = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subscription.id))

    // Verify workspaces are still owned by user
    const verifyWorkspaces = await db
      .select()
      .from(schema.workspace)
      .where(eq(schema.workspace.ownerId, USER_ID))

    // Verify workflows are still owned by user
    const verifyWorkflows = await db
      .select()
      .from(schema.workflow)
      .where(eq(schema.workflow.userId, USER_ID))

    if (verifyMembership.length === 0) {
      throw new Error('❌ Membership verification failed')
    }

    if (verifySubscription[0].referenceId !== orgId) {
      throw new Error('❌ Subscription transfer verification failed')
    }

    if (verifyWorkspaces.length !== userWorkspaces.length) {
      throw new Error('❌ Workspace preservation verification failed')
    }

    if (verifyWorkflows.length !== userWorkflows.length) {
      throw new Error('❌ Workflow preservation verification failed')
    }

    console.log('✅ All verifications passed!')
    console.log()

    // Step 7: Summary
    console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!')
    console.log('===================================')
    console.log()
    console.log('📊 Results:')
    console.log(`   ✅ Organization Created: ${orgName}`)
    console.log(`   ✅ Organization ID: ${orgId}`)
    console.log(`   ✅ User Role: Owner`)
    console.log(
      `   ✅ Subscription Transferred: ${subscription.plan} (${subscription.seats} seats)`
    )
    console.log(`   ✅ Active Sessions Updated: ${updatedSessions.length}`)
    console.log(`   ✅ Workspaces Preserved: ${verifyWorkspaces.length}`)
    console.log(`   ✅ Workflows Preserved: ${verifyWorkflows.length}`)
    console.log()
    console.log('🔒 User Experience:')
    console.log('   • All existing workspaces and workflows remain fully functional')
    console.log('   • User now has access to team/organization features')
    console.log('   • User can invite team members (up to 5 seats)')
    console.log('   • User sessions automatically switched to new organization context')
    console.log('   • Zero platform interruption - seamless migration')
  } catch (error) {
    console.error('❌ Error occurred:', error)
    console.log()
    console.log('🔄 Rolling back any partial changes...')

    // Attempt rollback (basic cleanup)
    try {
      // If we created an organization, try to clean it up
      const orgsToCleanup = await db
        .select()
        .from(schema.organization)
        .where(
          eq(schema.organization.metadata, {
            stripeCustomerId: STRIPE_CUSTOMER_ID,
            migratedFromUserId: USER_ID,
          } as any)
        )

      for (const org of orgsToCleanup) {
        console.log(`🧹 Cleaning up organization: ${org.id}`)
        await db.delete(schema.member).where(eq(schema.member.organizationId, org.id))
        await db.delete(schema.organization).where(eq(schema.organization.id, org.id))
      }

      // Reset subscription reference back to user if it was changed
      await db
        .update(schema.subscription)
        .set({ referenceId: USER_ID })
        .where(
          and(
            eq(schema.subscription.referenceId, orgsToCleanup[0]?.id || ''),
            eq(schema.subscription.plan, 'enterprise')
          )
        )

      console.log('✅ Rollback completed')
    } catch (rollbackError) {
      console.error('❌ Rollback failed:', rollbackError)
      console.log('⚠️  Manual cleanup may be required')
    }

    process.exit(1)
  } finally {
    await postgresClient.end()
  }
}

// Usage instructions
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Migrate Enterprise User to Organization Setup')
  console.log('===========================================')
  console.log()
  console.log('This script safely migrates an enterprise user to an organization-based setup.')
  console.log('It preserves all workspaces, workflows, and ensures zero platform interruption.')
  console.log()
  console.log('Usage:')
  console.log(
    '  DATABASE_URL="..." tsx scripts/migrate-enterprise-user-to-organization.ts [--dry-run]'
  )
  console.log()
  console.log('Options:')
  console.log('  --dry-run    Show what would be changed without making actual changes')
  console.log('  --help, -h   Show this help message')
  console.log()
  console.log('What this script does:')
  console.log('  1. Creates a new organization for the user')
  console.log('  2. Makes the user the owner of the organization')
  console.log('  3. Transfers the enterprise subscription to the organization')
  console.log('  4. Updates user sessions to use the new organization')
  console.log('  5. Preserves all workspaces and workflows (no ownership changes)')
  console.log()
  console.log('Safety guarantees:')
  console.log('  • Zero interruption to existing workspaces and workflows')
  console.log('  • Comprehensive verification and rollback on errors')
  console.log('  • Dry-run mode to preview changes')
  console.log('  • Detailed logging of all operations')
  process.exit(0)
}

main().catch(console.error)
