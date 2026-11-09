'use client'

import { clearBrowserUserData } from '@/lib/auth/browser-storage'
import {
  LOGOUT_PATH,
  useAccountDeletion as useSharedAccountDeletion,
} from '@/platform/shared/account'

/** The product has no in-memory stores to reset. */
export function useAccountDeletion(email: string) {
  return useSharedAccountDeletion(email, {
    logoutHref: LOGOUT_PATH,
    clearUserData: clearBrowserUserData,
  })
}
