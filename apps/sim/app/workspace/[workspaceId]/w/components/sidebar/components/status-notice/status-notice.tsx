'use client'

import { ChipLink } from '@sim/emcn'
import { CircleAlert } from '@sim/emcn/icons'
import { STATUS_PAGE_URL } from '@/lib/status-page'
import { useStatusPage } from '@/hooks/queries/status-page'

const PREVIEW_STATUS = {
  description: 'Major Service Outage',
  indicator: 'critical',
} as const

interface StatusNoticeProps {
  preview?: boolean
}

function StatusAlert() {
  return (
    <div
      role='alert'
      className='flex w-full flex-col gap-2 rounded-xl border border-[var(--terminal-status-error-border)] bg-[var(--terminal-status-error-bg)] p-2 [--surface-hover:color-mix(in_srgb,var(--text-error)_8%,transparent)]'
    >
      <div className='flex min-w-0 items-center gap-1.5'>
        <CircleAlert className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        <p className='min-w-0 text-[var(--text-body)] text-sm leading-5'>Sim is having issues</p>
      </div>
      <ChipLink
        fullWidth
        variant='border'
        className='justify-center'
        href={STATUS_PAGE_URL}
        target='_blank'
        rel='noopener noreferrer'
      >
        View status
      </ChipLink>
    </div>
  )
}

export function StatusNotice({ preview = false }: StatusNoticeProps) {
  const { data } = useStatusPage({ enabled: !preview })

  const status = preview ? PREVIEW_STATUS : data?.status

  if (status?.indicator !== 'major' && status?.indicator !== 'critical') {
    return null
  }

  /* The gutter lives here rather than on the sidebar's slot: a slot padded for a
     notice that renders nothing would hold an empty band above the footer. */
  return (
    <div className='shrink-0 px-2 py-2'>
      <StatusAlert />
    </div>
  )
}
