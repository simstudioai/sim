import { cn } from '@sim/emcn'
import { Calendar } from '@sim/emcn/icons'
import Image from 'next/image'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

/** An illustrative crop of the changelog's featured update and story cards. */
export function ChangelogMenuPreview() {
  return (
    <MenuPreviewFrame kind='changelog'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={Calendar} title='Changelog' />
        <div className='space-y-6 p-6'>
          <div className='grid grid-cols-2 items-center gap-5'>
            <Image
              src='/changelog/power-bi-query-v1.jpg'
              alt=''
              width={1440}
              height={900}
              sizes='274px'
              loading='lazy'
              unoptimized
              className={cn('aspect-video object-cover', LANDING_STAGE_RADIUS)}
            />
            <div>
              <div className='text-[var(--text-primary)] text-xl leading-tight'>
                Bring Power BI data into your agents
              </div>
              <p className='mt-2 text-[var(--text-secondary)] leading-relaxed'>
                Query models, inspect reports, and request refreshes.
              </p>
            </div>
          </div>
          <div className='grid grid-cols-2 gap-5 border-[var(--border)] border-t pt-5'>
            <div className='text-[var(--text-primary)] text-base'>
              Review changes before syncing a workspace fork
            </div>
            <div className='text-[var(--text-primary)] text-base'>Compare workflow deployments</div>
          </div>
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
