'use client'
import { Chip, cn, Loader } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

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
          <h1 className='font-[500] text-[32px] text-[var(--text-primary)] tracking-tight'>
            Loading
          </h1>
          <p className='font-[380] text-[var(--text-muted)]'>{description}</p>
        </div>
        <div className='mt-8 flex w-full items-center justify-center py-8'>
          <Loader className='size-8 text-[var(--text-muted)]' animate />
        </div>
      </>
    )
  }

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='font-[500] text-[32px] text-[var(--text-primary)] tracking-tight'>
          {title}
        </h1>
        <p className='font-[380] text-[var(--text-muted)]'>{description}</p>
      </div>

      <div className='mt-8 w-full max-w-[410px] space-y-3'>
        {isExpiredError && (
          <AuthSubmitButton type='button' onClick={() => router.push('/')} loadingLabel=''>
            Request New Invitation
          </AuthSubmitButton>
        )}

        {actions.map((action, index) =>
          index === 0 ? (
            <AuthSubmitButton
              key={action.label}
              type='button'
              onClick={action.onClick}
              disabled={action.disabled}
              loading={action.loading}
              loadingLabel={`${action.label}...`}
            >
              {action.label}
            </AuthSubmitButton>
          ) : (
            <Chip
              key={action.label}
              fullWidth
              flush
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border-1)]')}
            >
              {action.loading ? (
                <span className='flex items-center gap-2'>
                  <Loader className='size-4' animate />
                  {action.label}...
                </span>
              ) : (
                action.label
              )}
            </Chip>
          )
        )}
      </div>
    </>
  )
}
