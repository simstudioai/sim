'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { BrandedButton } from '@/app/(auth)/components/branded-button'

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
          <h1 className='font-[500] text-[#ECECEC] text-[32px] tracking-tight'>Loading</h1>
          <p className='font-[380] text-[#999] text-[16px]'>{description}</p>
        </div>
        <div className='mt-8 flex w-full items-center justify-center py-8'>
          <Loader2 className='h-8 w-8 animate-spin text-[#999]' />
        </div>
      </>
    )
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='font-[500] text-[#ECECEC] text-[32px] tracking-tight'>{title}</h1>
        <p className='font-[380] text-[#999] text-[16px]'>{description}</p>
      </div>

      <div className='mt-8 w-full max-w-[410px] space-y-3'>
        {isExpiredError && (
          <BrandedButton onClick={() => router.push('/')} showArrow={false}>
            Request New Invitation
          </BrandedButton>
        )}

        {actions.map((action, index) => (
          <BrandedButton
            key={index}
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            loading={action.loading}
            loadingText={action.label}
            showArrow={false}
            className={
              index !== 0
                ? 'border-[#3d3d3d] bg-transparent text-[#ECECEC] hover:border-[#3d3d3d] hover:bg-[#2A2A2A]'
                : undefined
            }
          >
            {action.label}
          </BrandedButton>
        ))}
      </div>
    </>
  )
}
