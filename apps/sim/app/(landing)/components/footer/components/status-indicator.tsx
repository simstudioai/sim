'use client'

import Link from 'next/link'
import { StatusDotIcon } from '@/components/icons'
import type { StatusType } from '@/app/api/status/types'
import { useStatus } from '@/hooks/queries/status'

const STATUS_COLORS: Record<StatusType, string> = {
  operational: 'text-[#10B981] hover:text-[#059669]',
  degraded: 'text-[#F59E0B] hover:text-[#D97706]',
  outage: 'text-[#EF4444] hover:text-[#DC2626]',
  maintenance: 'text-[#3B82F6] hover:text-[#2563EB]',
  loading: 'text-muted-foreground hover:text-foreground',
  error: 'text-muted-foreground hover:text-foreground',
}

export default function StatusIndicator() {
  const { data, isLoading, isError } = useStatus()

  const status = isLoading ? 'loading' : isError ? 'error' : data?.status || 'error'
  const message = isLoading
    ? 'Checking Status...'
    : isError
      ? 'Status Unknown'
      : data?.message || 'Status Unknown'
  const statusUrl = data?.url || 'https://status.sim.ai'

  return (
    <Link
      href={statusUrl}
      target='_blank'
      rel='noopener noreferrer'
      className={`flex items-center gap-[6px] whitespace-nowrap text-[12px] transition-colors ${STATUS_COLORS[status]}`}
      aria-label={`System status: ${message}`}
    >
      <StatusDotIcon status={status} className='h-[6px] w-[6px]' aria-hidden='true' />
      <span>{message}</span>
    </Link>
  )
}
