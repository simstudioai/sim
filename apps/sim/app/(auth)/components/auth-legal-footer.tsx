import { AuthLegal } from '@sim/auth-ui'
import { getBrandConfig } from '@/ee/whitelabeling'

interface AuthLegalFooterProps {
  action: string
}
export function AuthLegalFooter({ action }: AuthLegalFooterProps) {
  const brand = getBrandConfig()
  return (
    <AuthLegal
      action={action}
      termsHref={brand.termsUrl || '/terms'}
      privacyHref={brand.privacyUrl || '/privacy'}
    />
  )
}
