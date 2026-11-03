'use client'

import { AuthTextLink } from '@sim/auth-ui'
import { useBrandConfig } from '@/ee/whitelabeling'

export function SupportFooter() {
  const brand = useBrandConfig()
  return <AuthTextLink href={`mailto:${brand.supportEmail}`}>Contact support</AuthTextLink>
}
