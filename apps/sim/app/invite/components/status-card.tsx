'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SupportFooter } from '@/app/(auth)/components/support-footer'

interface InviteStatusCardProps {
  type: 'login' | 'loading' | 'error' | 'success' | 'invitation' | 'warning'
  title: string
  description: string | React.ReactNode
  icon?: 'userPlus' | 'mail' | 'users' | 'error' | 'success' | 'warning'
  actions?: Array<{
    label: string
    onClick: () => void
    disabled?: boolean
    loading?: boolean
  }>
  isExpiredError?: boolean
}

export function InviteStatusCard({
  type,
  title,
  description,
  icon: _icon,
  actions = [],
  isExpiredError = false,
}: InviteStatusCardProps) {
  const router = useRouter()

  if (type === 'loading') {
    return (
      <>
        <div className='space-y-1 text-center'>
          <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
            Loading
          </h1>
          <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
            {description}
          </p>
        </div>
        <div className={`${inter.className} mt-8 flex w-full items-center justify-center py-8`}>
          <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
        </div>
        <SupportFooter position='absolute' />
      </>
    )
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
          {title}
        </h1>
        <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
          {description}
        </p>
      </div>

      <div className={`${inter.className} mt-8 w-full max-w-[410px] space-y-3`}>
        {isExpiredError && (
          <BrandedButton onClick={() => router.push('/')}>Request New Invitation</BrandedButton>
        )}

        {actions.map((action, index) => (
          <BrandedButton
            key={index}
            onClick={action.onClick}
            disabled={action.disabled}
            loading={action.loading}
            loadingText={action.label}
          >
            {action.label}
          </BrandedButton>
        ))}
      </div>

      <SupportFooter position='absolute' />
    </>
  )
}
