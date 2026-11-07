'use client'

import { clearBrowserUserData } from '@/lib/auth/browser-storage'
import {
  LOGOUT_PATH,
  useAccountDeletion as useSharedAccountDeletion,
} from '@/platform/shared/account'

/** The zone has no in-memory stores to reset, and the logout route is on the legacy origin. */
export function useAccountDeletion(email: string, legacyOrigin: string) {
  return useSharedAccountDeletion(email, {
    logoutHref: `${legacyOrigin}${LOGOUT_PATH}`,
    clearUserData: clearBrowserUserData,
  })
}
