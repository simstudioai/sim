'use client'

import { AuthModal } from '@/app/(landing)/components/auth-modal/auth-modal'
import { trackLandingCta } from '@/app/(landing)/landing-analytics'

interface IntegrationCtaButtonProps {
  children: React.ReactNode
  className?: string
  label: string
}

export function IntegrationCtaButton({ children, className, label }: IntegrationCtaButtonProps) {
  return (
    <AuthModal defaultView='signup' source='integrations'>
      <button
        type='button'
        className={className}
        onClick={() =>
          trackLandingCta({ label, section: 'integrations', destination: 'auth_modal' })
        }
      >
        {children}
      </button>
    </AuthModal>
  )
}
