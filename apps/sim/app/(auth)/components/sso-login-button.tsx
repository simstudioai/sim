'use client'
import { Chip } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { isSsoEnabled } from '@/lib/core/config/env-flags'

interface SSOLoginButtonProps {
  callbackURL?: string
  className?: string
  variant?: 'primary' | 'outline'
}

export function SSOLoginButton({
  callbackURL,
  className,
  variant = 'outline',
}: SSOLoginButtonProps) {
  const router = useRouter()

  if (!isSsoEnabled) {
    return null
  }

  const handleSSOClick = () => {
    const ssoUrl = `/sso${callbackURL ? `?callbackUrl=${encodeURIComponent(callbackURL)}` : ''}`
    router.push(ssoUrl)
  }

  return (
    <Chip
      variant={variant}
      fullWidth
      onClick={handleSSOClick}
      size='lg'
      align='center'
      className={className}
    >
      Sign in with SSO
    </Chip>
  )
}
