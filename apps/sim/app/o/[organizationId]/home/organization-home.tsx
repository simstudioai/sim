import { Composer } from '@/app/o/[organizationId]/home/components/composer'
import { GetStarted } from '@/app/o/[organizationId]/home/components/get-started'

interface OrganizationHomeProps {
  userName?: string
}

/**
 * The organization home: a greeting over the composer, centered the same way
 * the workspace chat's empty state is.
 */
export function OrganizationHome({ userName }: OrganizationHomeProps) {
  const firstName = userName?.split(' ')[0] ?? ''

  return (
    <div className='relative flex h-full bg-[var(--bg)]'>
      <div className='h-full flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
        <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
          <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
            What should we get done{firstName ? `, ${firstName}` : ''}?
          </h1>
          <div className='relative w-full max-w-chat'>
            <Composer />
            {/* Anchored out of flow so expanding/collapsing never shifts the centered input */}
            <div className='absolute inset-x-0 top-full'>
              <GetStarted />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
