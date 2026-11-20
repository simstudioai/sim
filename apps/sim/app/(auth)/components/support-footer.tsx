'use client'

import { AuthTextLink } from '@sim/auth-ui'
import { SUPPORT_EMAIL } from '@/lib/branding/contact'

export function SupportFooter() {
  return <AuthTextLink href={`mailto:${SUPPORT_EMAIL}`}>Contact support</AuthTextLink>
}
