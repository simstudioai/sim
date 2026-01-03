'use client'

import { useState } from 'react'
import { ArrowRight, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'

interface InviteStatusCardProps {
  type: 'login' | 'loading' | 'error' | 'success' | 'invitation' | 'warning'
  title: string
  description: string | React.ReactNode
  icon?: 'userPlus' | 'mail' | 'users' | 'error' | 'success' | 'warning'
  actions?: Array<{
    label: string
    onClick: () => void
    variant?: 'default' | 'outline' | 'ghost'
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
  const [hoveredButtonIndex, setHoveredButtonIndex] = useState<number | null>(null)
  const brandConfig = useBrandConfig()

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
        <div
          className={`${inter.className} auth-text-muted absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] leading-relaxed sm:px-8 md:px-[44px]`}
        >
          Need help?{' '}
          <a
            href={`mailto:${brandConfig.supportEmail}`}
            className='auth-link underline-offset-4 transition hover:underline'
          >
            Contact support
          </a>
        </div>
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

      <div className={`${inter.className} mt-8 space-y-8`}>
        <div className='flex w-full flex-col gap-3'>
          {isExpiredError && (
            <Button
              variant='outline'
              className='w-full rounded-[10px] border-[var(--brand-primary-hex)] font-medium text-[15px] text-[var(--brand-primary-hex)] transition-colors duration-200 hover:bg-[var(--brand-primary-hex)] hover:text-white'
              onClick={() => router.push('/')}
            >
              <RotateCcw className='mr-2 h-4 w-4' />
              Request New Invitation
            </Button>
          )}

          {actions.map((action, index) => {
            const isPrimary = (action.variant || 'default') === 'default'
            const isHovered = hoveredButtonIndex === index

            if (isPrimary) {
              return (
                <Button
                  key={index}
                  onMouseEnter={() => setHoveredButtonIndex(index)}
                  onMouseLeave={() => setHoveredButtonIndex(null)}
                  className='group inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] py-[6px] pr-[10px] pl-[12px] text-[15px] text-white shadow-[inset_0_2px_4px_0_#9B77FF] transition-all'
                  onClick={action.onClick}
                  disabled={action.disabled || action.loading}
                >
                  <span className='flex items-center gap-1'>
                    {action.loading ? `${action.label}...` : action.label}
                    <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
                      {isHovered ? (
                        <ArrowRight className='h-4 w-4' aria-hidden='true' />
                      ) : (
                        <ChevronRight className='h-4 w-4' aria-hidden='true' />
                      )}
                    </span>
                  </span>
                </Button>
              )
            }

            return (
              <Button
                key={index}
                variant={action.variant}
                className={
                  action.variant === 'outline'
                    ? 'w-full rounded-[10px] border-[var(--brand-primary-hex)] font-medium text-[15px] text-[var(--brand-primary-hex)] transition-colors duration-200 hover:bg-[var(--brand-primary-hex)] hover:text-white'
                    : 'w-full rounded-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground'
                }
                onClick={action.onClick}
                disabled={action.disabled || action.loading}
              >
                {action.loading ? `${action.label}...` : action.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div
        className={`${inter.className} auth-text-muted absolute right-0 bottom-0 left-0 px-8 pb-8 text-center font-[340] text-[13px] leading-relaxed sm:px-8 md:px-[44px]`}
      >
        Need help?{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='auth-link underline-offset-4 transition hover:underline'
        >
          Contact support
        </a>
      </div>
    </>
  )
}
