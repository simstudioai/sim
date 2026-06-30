'use client'

import { Chip } from '@/components/emcn'
import { AuthModal } from '@/app/(landing)/components/auth-modal/auth-modal'
import { trackLandingCta } from '@/app/(landing)/landing-analytics'

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
