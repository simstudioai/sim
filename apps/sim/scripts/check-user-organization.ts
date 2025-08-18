#!/usr/bin/env tsx

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

const USER_ID = '7vBgXHU57ySMa47wIW8TKVW6rEJJu2Gl'

async function main() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required')
    process.exit(1)
  }

  console.log('🔍 Checking User Organization/Team Association')
  console.log('============================================')
  console.log(`User ID: ${USER_ID}`)
  console.log()

  // Initialize database connection
  const postgresClient = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })
  const db = drizzle(postgresClient, { schema })

  try {
    // Step 1: Get user info
    console.log('👤 Step 1: Getting user information...')
    const users = await db.select().from(schema.user).where(eq(schema.user.id, USER_ID)).limit(1)

    if (users.length === 0) {
      console.error(`❌ User with ID ${USER_ID} not found`)
      await postgresClient.end()
      process.exit(1)
    }

    const user = users[0]
    console.log(`✅ User: ${user.name} (${user.email})`)
    console.log(`   Stripe Customer ID: ${user.stripeCustomerId || 'None'}`)
    console.log()

    // Step 2: Check memberships
    console.log('🏢 Step 2: Checking organization memberships...')
    const memberships = await db
      .select({
        memberId: schema.member.id,
        organizationId: schema.member.organizationId,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
        orgName: schema.organization.name,
        orgSlug: schema.organization.slug,
        orgCreatedAt: schema.organization.createdAt,
        orgMetadata: schema.organization.metadata,
      })
      .from(schema.member)
      .leftJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
      .where(eq(schema.member.userId, USER_ID))

    if (memberships.length === 0) {
      console.log('❌ User is not a member of any organizations')
    } else {
      console.log(`✅ User is a member of ${memberships.length} organization(s):`)
      console.log()
      memberships.forEach((membership, index) => {
        console.log(`   🏢 Organization #${index + 1}:`)
        console.log(`      Name: ${membership.orgName}`)
        console.log(`      Slug: ${membership.orgSlug}`)
        console.log(`      Organization ID: ${membership.organizationId}`)
        console.log(`      User Role: ${membership.role}`)
        console.log(`      Member Since: ${membership.createdAt}`)
        console.log(`      Org Created: ${membership.orgCreatedAt}`)
        if (membership.orgMetadata) {
          console.log(`      Org Metadata: ${JSON.stringify(membership.orgMetadata, null, 6)}`)
        }
        console.log()
      })
    }

    // Step 3: Check subscriptions for user and any organizations
    console.log('💳 Step 3: Checking subscriptions...')

    // User subscriptions
    const userSubscriptions = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, USER_ID))

    console.log(`📋 User subscriptions: ${userSubscriptions.length}`)
    userSubscriptions.forEach((sub, index) => {
      console.log(
        `   ${index + 1}. Plan: ${sub.plan}, Status: ${sub.status}, Seats: ${sub.seats || 'N/A'}`
      )
    })

    // Organization subscriptions
    if (memberships.length > 0) {
      console.log()
      console.log('📋 Organization subscriptions:')
      for (const membership of memberships) {
        const orgSubscriptions = await db
          .select()
          .from(schema.subscription)
          .where(eq(schema.subscription.referenceId, membership.organizationId))

        console.log(`   Org "${membership.orgName}": ${orgSubscriptions.length} subscription(s)`)
        orgSubscriptions.forEach((sub, index) => {
          console.log(
            `      ${index + 1}. Plan: ${sub.plan}, Status: ${sub.status}, Seats: ${sub.seats || 'N/A'}`
          )
        })
      }
    }

    // Step 4: Check current active session organization
    console.log()
    console.log('🔐 Step 4: Checking active sessions...')
    const sessions = await db
      .select({
        sessionId: schema.session.id,
        activeOrganizationId: schema.session.activeOrganizationId,
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, USER_ID))
      .limit(5) // Show recent sessions

    if (sessions.length === 0) {
      console.log('ℹ️  No sessions found for user')
    } else {
      console.log(`📱 Found ${sessions.length} session(s):`)
      sessions.forEach((session, index) => {
        console.log(`   ${index + 1}. Active Org: ${session.activeOrganizationId || 'None'}`)
        console.log(`      Created: ${session.createdAt}`)
        console.log(`      Expires: ${session.expiresAt}`)
      })
    }

    console.log()
    console.log('📊 Summary:')
    console.log(`   User has ${memberships.length} organization membership(s)`)
    console.log(`   User has ${userSubscriptions.length} direct subscription(s)`)
    if (memberships.length > 0) {
      const totalOrgSubs = await Promise.all(
        memberships.map((m) =>
          db
            .select()
            .from(schema.subscription)
            .where(eq(schema.subscription.referenceId, m.organizationId))
        )
      )
      const totalOrgSubsCount = totalOrgSubs.reduce((sum, subs) => sum + subs.length, 0)
      console.log(`   Organizations have ${totalOrgSubsCount} total subscription(s)`)
    }
  } catch (error) {
    console.error('❌ Error occurred:', error)
    process.exit(1)
  } finally {
    await postgresClient.end()
  }
}

main().catch(console.error)
