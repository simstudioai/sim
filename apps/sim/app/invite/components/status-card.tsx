'use client'
import { Chip, Loader } from '@sim/emcn'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { InviteHeading } from '@/app/invite/components/invite-heading'

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
        <InviteHeading title={'Loading'}>
          <p className='text-[var(--text-muted)]'>{description}</p>
        </InviteHeading>
        <div className='mt-8 flex w-full items-center justify-center py-8'>
          <Loader className='size-8 text-[var(--text-muted)]' animate />
        </div>
      </>
    )
  }

  return (
    <>
      <InviteHeading title={title}>
        <p className='text-[var(--text-muted)]'>{description}</p>
      </InviteHeading>

      <div className='mt-8 w-full max-w-[410px] space-y-3'>
        {details}
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
              variant='outline'
              size='lg'
              align='center'
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
