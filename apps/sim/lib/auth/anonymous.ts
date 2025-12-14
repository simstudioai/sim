import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AnonymousAuth')

export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000'

export const ANONYMOUS_USER = {
  id: ANONYMOUS_USER_ID,
  name: 'Anonymous',
  email: 'anonymous@localhost',
  emailVerified: true,
  image: null,
} as const

let anonymousUserEnsured = false

/**
 * Ensures the anonymous user exists in the database.
 * Called when DISABLE_AUTH is enabled to ensure DB operations work.
 */
export async function ensureAnonymousUserExists(): Promise<void> {
  if (anonymousUserEnsured) return

  try {
    const existingUser = await db.query.user.findFirst({
      where: eq(schema.user.id, ANONYMOUS_USER_ID),
    })

    if (!existingUser) {
      const now = new Date()
      await db.insert(schema.user).values({
        ...ANONYMOUS_USER,
        createdAt: now,
        updatedAt: now,
      })
      logger.info('Created anonymous user for DISABLE_AUTH mode')
    }

    anonymousUserEnsured = true
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('unique') || error.message.includes('duplicate'))
    ) {
      anonymousUserEnsured = true
      return
    }
    logger.error('Failed to ensure anonymous user exists', { error })
    throw error
  }
}

export interface AnonymousSession {
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: null
    createdAt: Date
    updatedAt: Date
  }
  session: {
    id: string
    userId: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
    token: string
    ipAddress: null
    userAgent: null
  }
}

/**
 * Creates an anonymous session for when auth is disabled.
 */
export function createAnonymousSession(): AnonymousSession {
  const now = new Date()
  return {
    user: {
      ...ANONYMOUS_USER,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: 'anonymous-session',
      userId: ANONYMOUS_USER_ID,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      createdAt: now,
      updatedAt: now,
      token: 'anonymous-token',
      ipAddress: null,
      userAgent: null,
    },
  }
}
