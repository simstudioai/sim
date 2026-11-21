'use client'

import { AuthTextLink } from '@sim/auth-ui'
import { SIM_SUPPORT_EMAIL } from '@sim/utils/site'

export function SupportFooter() {
  return <AuthTextLink href={`mailto:${SIM_SUPPORT_EMAIL}`}>Contact support</AuthTextLink>
}
