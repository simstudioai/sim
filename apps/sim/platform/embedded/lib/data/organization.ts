'use client'

import { ANONYMOUS_USER_ID } from '@sim/auth/principal'
import { useSession } from '@/lib/auth/client'

/** An auth-disabled deployment's viewer has no account to manage and cannot sign out. */
export function useAnonymousViewer() {
  const { data: session } = useSession()
  return session?.user?.id === ANONYMOUS_USER_ID
}
