'use client'
import { AuthStack, AuthButton as Chip, cn, AuthLoader as Loader } from '@sim/auth-ui'
import { AuthHeader, AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

/** A document navigation, so the marketing surface initializes its own theme store. */
function returnHome(): void {
  window.location.href = '/'
}

interface InviteStatusCardProps {
  type: 'login' | 'loading' | 'error' | 'success' | 'invitation' | 'warning'
  title: string
  description: string | React.ReactNode
  details?: React.ReactNode
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
  details,
  icon: _icon,
  actions = EMPTY_ACTIONS,
  isExpiredError = false,
}: InviteStatusCardProps) {
  if (type === 'loading') {
    return (
      <>
        <AuthHeader title='Loading' description={description} />
        <div className='au:mt-[var(--auth-group-gap)] au:flex au:w-full au:items-center au:justify-center au:py-8'>
          <Loader className='au:size-8 au:text-[var(--auth-secondary)]' animate />
        </div>
      </>
    )
  }

  return (
    <AuthStack>
      <AuthHeader title={title} description={description} />

      {details}
      <div className='au:w-full au:space-y-2'>
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
              className={cn(AUTH_BUTTON_CLASS, 'au:border au:border-[var(--auth-border)]')}
            >
              {action.loading ? (
                <span className='au:flex au:items-center au:gap-2'>
                  <Loader className='au:size-4' animate />
                  {action.label}...
                </span>
              ) : (
                action.label
              )}
            </Chip>
          )
        )}
      </div>
    </AuthStack>
  )
}
