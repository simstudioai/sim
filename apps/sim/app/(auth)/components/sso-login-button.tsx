'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'

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

  const outlineBtnClasses = cn('w-full rounded-[10px]')

  return (
    <Button
      type='button'
      onClick={handleSSOClick}
      variant={variant === 'outline' ? 'outline' : undefined}
      className={cn(variant === 'outline' ? outlineBtnClasses : AUTH_SUBMIT_BTN, className)}
    >
      Sign in with SSO
    </Button>
  )
}
