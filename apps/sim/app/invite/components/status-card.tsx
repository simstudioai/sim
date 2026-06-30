'use client'

import { useRouter } from 'next/navigation'
import { Chip, Loader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { AuthHeader } from '@/app/(auth)/components'
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

/**
 * Invite status surface (sign-in prompt, loading, error, success, accept) on the
 * light auth shell: the shared {@link AuthHeader} for the heading/subcopy and
 * chip buttons at the auth control height — the first action is the primary
 * chip, the rest are outline chips.
 */
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
      <div className='space-y-6'>
        <AuthHeader title='Loading' description={description} />
        <div className='flex w-full items-center justify-center py-8'>
          <Loader className='size-8 text-[var(--text-muted)]' animate />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      <AuthHeader title={title} description={description} />

      <div className='space-y-2.5'>
        {isExpiredError && (
          <Chip
            variant='primary'
            fullWidth
            flush
            onClick={() => router.push('/')}
            className={AUTH_BUTTON_CLASS}
          >
            Request New Invitation
          </Chip>
        )}

        {actions.map((action, index) => (
          <Chip
            key={action.label}
            variant={index === 0 ? 'primary' : undefined}
            fullWidth
            flush
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
            className={cn(AUTH_BUTTON_CLASS, index !== 0 && 'border border-[var(--border-1)]')}
          >
            {action.loading ? (
              <span className='flex items-center gap-2'>
                <Loader className='size-4' animate />
                {action.label}…
              </span>
            ) : (
              action.label
            )}
          </Chip>
        ))}
      </div>
    </div>
  )
}
