'use client'
import { Chip, cn, Loader } from '@sim/emcn'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

/** A document navigation, so the marketing surface initializes its own theme store. */
function returnHome(): void {
  window.location.href = '/'
}

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
  if (type === 'loading') {
    return (
      <>
        <div className='space-y-1 text-center'>
          <h1 className='text-[32px] text-[var(--text-primary)] tracking-tight'>Loading</h1>
          <p className='text-[var(--text-muted)]'>{description}</p>
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
        <h1 className='text-[32px] text-[var(--text-primary)] tracking-tight'>{title}</h1>
        <p className='text-[var(--text-muted)]'>{description}</p>
      </div>

      <div className='mt-8 w-full max-w-[410px] space-y-3'>
        {isExpiredError && (
          <AuthSubmitButton type='button' onClick={returnHome} loadingLabel=''>
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
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border)]')}
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
