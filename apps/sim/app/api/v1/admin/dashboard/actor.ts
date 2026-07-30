import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import type { AdminMutationActor } from '@/lib/admin/dashboard'

export async function getAdminAuditActor(request: NextRequest): Promise<AdminMutationActor> {
  const email = request.headers.get('x-admin-email')?.trim().toLowerCase()
  if (!email) return { id: null, name: 'Admin API', email: null }
  const [admin] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(or(eq(user.email, email), eq(user.normalizedEmail, email)))
    .limit(1)
  return admin ?? { id: null, name: 'Admin Panel', email }
}
