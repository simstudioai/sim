'use client'

import { useRouter } from 'next/navigation'
import { Loader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { AUTH_PRIMARY_CTA_BASE } from '@/app/(auth)/components/auth-button-classes'

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

const EMPTY_ACTIONS: NonNullable<InviteStatusCardProps['actions']> = []

export function InviteStatusCard({
  type,
  title,
  description,
  icon: _icon,
  actions = EMPTY_ACTIONS,
  isExpiredError = false,
}: InviteStatusCardProps) {
  const router = useRouter()

  if (type === 'loading') {
    return (
      <>
        <div className='space-y-1 text-center'>
          <h1 className='font-[500] text-[32px] text-[var(--landing-text)] tracking-tight'>
            Loading
          </h1>
          <p className='font-[380] text-[var(--landing-text-muted)] text-md'>{description}</p>
        </div>
        <div className='mt-8 flex w-full items-center justify-center py-8'>
          <Loader className='size-8 text-[var(--landing-text-muted)]' animate />
        </div>
      </>
    )
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='font-[500] text-[32px] text-[var(--landing-text)] tracking-tight'>
          {title}
        </h1>
        <p className='font-[380] text-[var(--landing-text-muted)] text-md'>{description}</p>
      </div>

      <div className='mt-8 w-full max-w-[410px] space-y-3'>
        {isExpiredError && (
          <button onClick={() => router.push('/')} className={`${AUTH_PRIMARY_CTA_BASE} w-full`}>
            Request New Invitation
          </button>
        )}

        {actions.map((action, index) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            className={cn(
              `${AUTH_PRIMARY_CTA_BASE} w-full`,
              index !== 0 &&
                'border-[var(--landing-border-strong)] bg-transparent text-[var(--landing-text)] hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)] hover:text-[var(--landing-text)]'
            )}
          >
            {action.loading ? (
              <span className='flex items-center gap-2'>
                <Loader className='size-4' animate />
                {action.label}...
              </span>
            ) : (
              action.label
            )}
          </button>
        ))}
      </div>
    </>
  )
}
