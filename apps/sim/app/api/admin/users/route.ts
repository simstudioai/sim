import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { subscription, user, userStats } from '@/db/schema'
import { isAuthorized } from '../utils'

export async function GET(req: NextRequest) {
  try {
    // Admin authentication check
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const filter = url.searchParams.get('filter') || 'all'
    const search = url.searchParams.get('search') || ''
    const sortField = url.searchParams.get('sortField') || 'lastActive'
    const sortDirection = url.searchParams.get('sortDirection') || 'desc'

    // Build query using SQL template literals
    const query = sql`
      SELECT 
        ${user.id}, 
        ${user.name}, 
        ${user.email}, 
        ${user.createdAt} AS "createdAt", 
        ${user.updatedAt} AS "updatedAt",
        ${user.stripeCustomerId} AS "stripeCustomerId",
        
        COALESCE(${userStats.totalTokensUsed}, 0) AS "totalTokensUsed",
        COALESCE(${userStats.totalCost}, 0) AS "totalCost",
        COALESCE(${userStats.totalManualExecutions}, 0) AS "totalManualExecutions",
        COALESCE(${userStats.totalApiCalls}, 0) AS "totalApiCalls",
        COALESCE(${userStats.totalWebhookTriggers}, 0) AS "totalWebhookTriggers",
        COALESCE(${userStats.totalScheduledExecutions}, 0) AS "totalScheduledExecutions",
        COALESCE(${userStats.lastActive}, ${user.updatedAt}) AS "lastActive",
        
        ${subscription.plan} AS "subscriptionPlan",
        ${subscription.status} AS "subscriptionStatus"
      FROM 
        ${user}
      LEFT JOIN 
        ${userStats} ON ${user.id} = ${userStats.userId}
      LEFT JOIN 
        ${subscription} ON ${user.stripeCustomerId} = ${subscription.stripeCustomerId}
      ${search ? sql`WHERE (${user.name} ILIKE ${'%' + search + '%'} OR ${user.email} ILIKE ${'%' + search + '%'})` : sql``}
      ORDER BY ${getSortOrderSQL(sortField, sortDirection)}
    `

    // Execute the query with proper typing
    interface UserResult {
      id: string
      name: string
      email: string
      createdAt: Date
      updatedAt: Date
      stripeCustomerId: string | null
      totalTokensUsed: number
      totalCost: number
      totalManualExecutions: number
      totalApiCalls: number
      totalWebhookTriggers: number
      totalScheduledExecutions: number
      lastActive: Date
      subscriptionPlan: string | null
      subscriptionStatus: string | null
      [key: string]: unknown // Add index signature to satisfy Record<string, unknown>
    }

    const users = await db.execute<UserResult>(query)

    if (!users || users.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          users: [],
          pagination: {
            total: 0,
            page,
            limit,
            totalPages: 0,
          },
        },
      })
    }

    let filteredUsers = [...users]

    // Apply filters server-side
    if (filter !== 'all') {
      if (filter === 'active') {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        filteredUsers = filteredUsers.filter((user) => new Date(user.lastActive) > thirtyDaysAgo)
      } else if (filter === 'inactive') {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        filteredUsers = filteredUsers.filter((user) => new Date(user.lastActive) <= thirtyDaysAgo)
      } else if (filter === 'paid') {
        filteredUsers = filteredUsers.filter(
          (user) => user.subscriptionPlan && user.subscriptionPlan !== 'free'
        )
      }
    }

    // Get total count for pagination
    const totalCount = filteredUsers.length

    // Apply pagination
    const offset = (page - 1) * limit
    const paginatedUsers = filteredUsers.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      data: {
        users: paginatedUsers,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      },
    })
  } catch (error) {
    console.error('Error fetching user data:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'An unknown error occurred',
      },
      { status: 500 }
    )
  }
}

// Helper function to generate sort SQL
function getSortOrderSQL(sortField: string | null, sortDirection: string) {
  const direction = sortDirection === 'asc' ? sql`ASC` : sql`DESC`

  switch (sortField) {
    case 'name':
      return sql`${user.name} ${direction}`
    case 'email':
      return sql`${user.email} ${direction}`
    case 'totalTokensUsed':
      return sql`COALESCE(${userStats.totalTokensUsed}, 0) ${direction}`
    case 'totalCost':
      return sql`COALESCE(${userStats.totalCost}, 0) ${direction}`
    case 'totalExecutions':
      return sql`(COALESCE(${userStats.totalManualExecutions}, 0) + 
                 COALESCE(${userStats.totalWebhookTriggers}, 0) + 
                 COALESCE(${userStats.totalScheduledExecutions}, 0)) ${direction}`
    case 'lastActive':
      return sql`COALESCE(${userStats.lastActive}, ${user.updatedAt}) ${direction}`
    case 'subscriptionPlan':
      return sql`${subscription.plan} ${direction}`
    default:
      return sql`COALESCE(${userStats.lastActive}, ${user.updatedAt}) DESC`
  }
}
