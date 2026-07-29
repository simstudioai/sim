import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyEffectiveSuperUser } from '@/lib/permissions/super-user'

const logger = createLogger('NewsletterSuperuserAuth')

export async function validateNewsletterSuperuser() {
  const session = await getSession()
  if (!session?.user?.id) {
    return {
      success: false as const,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const { effectiveSuperUser, isSuperUser, superUserModeEnabled } = await verifyEffectiveSuperUser(
    session.user.id
  )

  if (!effectiveSuperUser) {
    logger.warn('Non-effective-superuser attempted to access newsletter admin endpoint', {
      userId: session.user.id,
      isSuperUser,
      superUserModeEnabled,
    })
    return {
      success: false as const,
      response: NextResponse.json(
        { error: 'Forbidden: Superuser access required' },
        { status: 403 }
      ),
    }
  }

  return { success: true as const, userId: session.user.id }
}
