'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { StatusDotIcon } from '@/components/icons'
import type { StatusResponse, StatusType } from '@/app/api/status/types'

const POLLING_INTERVAL = 60000

const STATUS_COLORS: Record<StatusType, string> = {
  operational: 'text-[#10B981] hover:text-[#059669]',
  degraded: 'text-[#F59E0B] hover:text-[#D97706]',
  outage: 'text-[#EF4444] hover:text-[#DC2626]',
  maintenance: 'text-[#3B82F6] hover:text-[#2563EB]',
  loading: 'text-muted-foreground hover:text-foreground',
  error: 'text-muted-foreground hover:text-foreground',
}

export default function StatusIndicator() {
  const [status, setStatus] = useState<StatusType>('loading')
  const [message, setMessage] = useState<string>('Checking Status...')
  const [statusUrl, setStatusUrl] = useState<string>('https://status.sim.ai')

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status')

      if (!response.ok) {
        throw new Error('Failed to fetch status')
      }

      const data: StatusResponse = await response.json()

      setStatus(data.status)
      setMessage(data.message)
      setStatusUrl(data.url)
    } catch (error) {
      console.error('Error fetching status:', error)
      setStatus('error')
      setMessage('Status Unknown')
    }
  }, [])

  useEffect(() => {
    fetchStatus()

    const poll = () => {
      fetchStatus().finally(() => {
        setTimeout(poll, POLLING_INTERVAL)
      })
    }

    const timeoutId = setTimeout(poll, POLLING_INTERVAL)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [fetchStatus])

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
