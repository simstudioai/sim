'use client'

import type { SVGProps } from 'react'
import Link from 'next/link'
import type { StatusType } from '@/app/api/status/types'
import { useStatus } from '@/hooks/queries/status'

interface StatusDotIconProps extends SVGProps<SVGSVGElement> {
  status: 'operational' | 'degraded' | 'outage' | 'maintenance' | 'loading' | 'error'
}

export function StatusDotIcon({ status, className, ...props }: StatusDotIconProps) {
  const colors = {
    operational: '#10B981',
    degraded: '#F59E0B',
    outage: '#EF4444',
    maintenance: '#3B82F6',
    loading: '#9CA3AF',
    error: '#9CA3AF',
  }

  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={6}
      height={6}
      viewBox='0 0 6 6'
      fill='none'
      className={className}
      {...props}
    >
      <circle cx={3} cy={3} r={3} fill={colors[status]} />
    </svg>
  )
}

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
      className={`flex min-w-[165px] items-center gap-[6px] whitespace-nowrap text-[12px] transition-colors ${STATUS_COLORS[status]}`}
      aria-label={`System status: ${message}`}
    >
      <StatusDotIcon status={status} className='h-[6px] w-[6px]' aria-hidden='true' />
      <span>{message}</span>
    </Link>
  )
}
