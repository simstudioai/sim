'use client'

import {
  LOGOUT_PATH,
  useAccountDeletion as useSharedAccountDeletion,
} from '@/platform/shared/account'
import { clearUserData } from '@/stores'

export function useAccountDeletion(email: string) {
  return useSharedAccountDeletion(email, { logoutHref: LOGOUT_PATH, clearUserData })
}
