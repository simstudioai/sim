import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import * as schema from '@/db/schema'

/**
 * Check if a user is authorized to manage billing for a given reference ID
 * Reference ID can be either a user ID (individual subscription) or organization ID (team subscription)
 */
export async function authorizeSubscriptionReference(
  userId: string,
  referenceId: string
): Promise<boolean> {
  // User can always manage their own subscriptions
  if (referenceId === userId) {
    return true
  }

  // Check if referenceId is an organizationId the user has admin rights to
  const members = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, referenceId)))

  const member = members[0]

  // Allow if the user is an owner or admin of the organization
  return member?.role === 'owner' || member?.role === 'admin'
}
