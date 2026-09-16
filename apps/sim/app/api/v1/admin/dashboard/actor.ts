import { db } from '@sim/db'
import { foldedEmail, user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import type { AdminMutationActor } from '@/lib/admin/dashboard'

export async function getAdminAuditActor(request: NextRequest): Promise<AdminMutationActor> {
  const rawEmail = request.headers.get('x-admin-email')
  const email = rawEmail ? normalizeEmail(rawEmail) : ''
  if (!email) return { id: null, name: 'Admin API', email: null }
  const [admin] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(foldedEmail(user.email), email))
    .limit(1)
  return admin ?? { id: null, name: 'Admin Panel', email }
}
