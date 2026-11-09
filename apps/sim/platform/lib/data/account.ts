'use client'

import {
  LOGOUT_PATH,
  useAccountDeletion as useSharedAccountDeletion,
} from '@/platform/shared/account'
import { clearUserData } from '@/stores'

/** Clears what the viewer holds in the tab, desktop tools first, as sign-out does. */
export function useAccountDeletion(email: string) {
  return useSharedAccountDeletion(email, {
    logoutHref: LOGOUT_PATH,
    clearUserData: () => clearUserData(),
  })
}
