'use client'

import { useConsentScript } from '@c15t/nextjs/headless'
import { X_PIXEL_SCRIPT } from '@/lib/consent/scripts'

export function SignupConsentTracking() {
  useConsentScript({ script: X_PIXEL_SCRIPT, unmountBehavior: 'keep' })
  return null
}
