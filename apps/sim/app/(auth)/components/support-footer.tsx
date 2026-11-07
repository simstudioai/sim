'use client'

import { AuthTextLink } from '@sim/emcn-auth/text-link'
import { useBrandConfig } from '@/ee/whitelabeling'

export function SupportFooter() {
  const brand = useBrandConfig()
  return <AuthTextLink href={`mailto:${brand.supportEmail}`}>Contact support</AuthTextLink>
}
