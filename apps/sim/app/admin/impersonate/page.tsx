import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import ImpersonateClient from './impersonate-client'

export const dynamic = 'force-dynamic'

/**
 * Admin impersonation page - allows superadmins to impersonate other users.
 */
export default async function ImpersonatePage() {
  const session = await getSession()

  if (!session?.user?.id) {
    notFound()
  }

  const [currentUser] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)

  if (currentUser?.role !== 'superadmin') {
    notFound()
  }

  return <ImpersonateClient currentUserId={session.user.id} />
}
