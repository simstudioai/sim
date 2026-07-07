'use client'

import { Chip } from '@sim/emcn'
import { AuthModal } from '@/app/(landing)/components/auth-modal/auth-modal'
import { trackLandingCta } from '@/app/(landing)/track-landing-cta'

interface IntegrationCtaButtonProps {
  children: React.ReactNode
  label: string
}

export function IntegrationCtaButton({ children, label }: IntegrationCtaButtonProps) {
  return (
    <AuthModal defaultView='signup' source='integrations'>
      <Chip
        variant='primary'
        onClick={() =>
          trackLandingCta({ label, section: 'integrations', destination: 'auth_modal' })
        }
      >
        {children}
      </Chip>
    </AuthModal>
  )
}
