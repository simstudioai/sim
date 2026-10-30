'use client'
import { AuthIcon, AuthButton as Chip } from '@sim/auth-ui'
import { useRouter } from 'next/navigation'
import { isSsoEnabled } from '@/lib/core/config/env-flags'

interface SSOLoginButtonProps {
  disabled?: boolean
  callbackURL?: string
  className?: string
  variant?: 'primary' | 'outline'
}

export function SSOLoginButton({
  disabled,
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
      variant={variant === 'primary' ? 'primary' : undefined}
      fullWidth
      disabled={disabled}
      onClick={handleSSOClick}
      className={className}
      leftIcon={() => <AuthIcon name='lock' />}
    >
      {variant === 'primary' ? 'Continue with SSO' : 'SSO'}
    </Chip>
  )
}
