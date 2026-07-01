'use client'
import { Chip, cn } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

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

  if (!isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))) {
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
      flush
      onClick={handleSSOClick}
      className={cn(
        AUTH_BUTTON_CLASS,
        variant === 'outline' && 'border border-[var(--border-1)]',
        className
      )}
    >
      Sign in with SSO
    </Chip>
  )
}
