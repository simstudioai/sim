import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

export async function arrangeEffectivePlatformAdmin(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(user).set({ role: 'admin', updatedAt: new Date() }).where(eq(user.id, userId))
    await tx
      .insert(settings)
      .values({ id: userId, userId, superUserModeEnabled: true })
      .onConflictDoUpdate({
        target: settings.userId,
        set: { superUserModeEnabled: true },
      })
  })
}
