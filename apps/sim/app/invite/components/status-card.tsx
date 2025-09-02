'use client'

import { CheckCircle2, Mail, RotateCcw, ShieldX, UserPlus, Users2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'

interface InviteStatusCardProps {
  type: 'login' | 'loading' | 'error' | 'success' | 'invitation'
  title: string
  description: string | React.ReactNode
  icon?: 'userPlus' | 'mail' | 'users' | 'error' | 'success'
  actions?: Array<{
    label: string
    onClick: () => void
    variant?: 'default' | 'outline' | 'ghost'
    disabled?: boolean
    loading?: boolean
  }>
  isExpiredError?: boolean
}

const iconMap = {
  userPlus: UserPlus,
  mail: Mail,
  users: Users2,
  error: ShieldX,
  success: CheckCircle2,
}

const iconColorMap = {
  userPlus: 'text-blue-500 dark:text-blue-400',
  mail: 'text-blue-500 dark:text-blue-400',
  users: 'text-blue-500 dark:text-blue-400',
  error: 'text-red-500 dark:text-red-400',
  success: 'text-green-500 dark:text-green-400',
}

const iconBgMap = {
  userPlus: 'bg-blue-50 dark:bg-blue-950/20',
  mail: 'bg-blue-50 dark:bg-blue-950/20',
  users: 'bg-blue-50 dark:bg-blue-950/20',
  error: 'bg-red-50 dark:bg-red-950/20',
  success: 'bg-green-50 dark:bg-green-950/20',
}

export function InviteStatusCard({
  type,
  title,
  description,
  icon,
  actions = [],
  isExpiredError = false,
}: InviteStatusCardProps) {
  const router = useRouter()

  if (type === 'loading') {
    return (
      <div className='flex w-full max-w-md flex-col items-center'>
        <LoadingAgent size='lg' />
        <p className='mt-4 text-gray-400 text-sm'>{description}</p>
      </div>
    )
  }

  const IconComponent = icon ? iconMap[icon] : null
  const iconColor = icon ? iconColorMap[icon] : ''
  const iconBg = icon ? iconBgMap[icon] : ''

  return (
    <div className='flex w-full max-w-md flex-col items-center text-center'>
      {IconComponent && (
        <div className={`mb-6 rounded-full p-3 ${iconBg}`}>
          <IconComponent className={`h-8 w-8 ${iconColor}`} />
        </div>
      )}

      <h1 className='mb-2 font-semibold text-black text-xl dark:text-white'>{title}</h1>

      <p className='mb-6 text-gray-600 text-sm leading-relaxed dark:text-gray-300'>{description}</p>

      <div className='flex w-full flex-col gap-3'>
        {isExpiredError && (
          <Button
            variant='outline'
            className='w-full border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white'
            onClick={() => router.push('/')}
          >
            <RotateCcw className='mr-2 h-4 w-4' />
            Request New Invitation
          </Button>
        )}

        {actions.map((action, index) => (
          <Button
            key={index}
            variant={action.variant || 'default'}
            className={
              action.variant === 'default'
                ? 'w-full'
                : action.variant === 'outline'
                  ? 'w-full border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white'
                  : 'w-full text-gray-600 hover:bg-gray-200 hover:text-black dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
            }
            style={
              action.variant === 'default'
                ? { backgroundColor: 'var(--brand-primary-hex)', color: 'white' }
                : undefined
            }
            onClick={action.onClick}
            disabled={action.disabled || action.loading}
          >
            {action.loading ? (
              <>
                <LoadingAgent size='sm' />
                {action.label}...
              </>
            ) : (
              action.label
            )}
          </Button>
        ))}
      </div>
    </div>
  )
}
