'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'

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

  const primaryBtnClasses = cn(
    'flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#6f3dfa] bg-gradient-to-b from-[#8357ff] to-[#6f3dfa] font-medium text-base text-white shadow-[inset_0_2px_4px_0_#9b77ff] transition-all duration-200 hover:opacity-90'
  )

  const outlineBtnClasses = cn('w-full rounded-[10px]')

  return (
    <Button
      type='button'
      onClick={handleSSOClick}
      variant={variant === 'outline' ? 'outline' : undefined}
      className={cn(variant === 'outline' ? outlineBtnClasses : primaryBtnClasses, className)}
    >
      Sign in with SSO
    </Button>
  )
}
