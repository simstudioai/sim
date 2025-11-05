'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import { useBrandConfig } from '@/lib/branding/branding'

interface ResumeLinks {
  apiUrl: string
  uiUrl: string
  contextId: string
  executionId: string
  workflowId: string
}

interface ResumeQueueEntrySummary {
  id: string
  contextId: string
  status: string
  queuedAt: string | null
  claimedAt: string | null
  completedAt: string | null
  failureReason: string | null
  newExecutionId: string
  resumeInput: any
}

interface PausePointWithQueue {
  contextId: string
  triggerBlockId: string
  response: any
  registeredAt: string
  resumeStatus: 'paused' | 'resumed' | 'failed' | 'queued' | 'resuming'
  snapshotReady: boolean
  resumeLinks?: ResumeLinks
  queuePosition?: number | null
  latestResumeEntry?: ResumeQueueEntrySummary | null
}

interface PausedExecutionSummary {
  id: string
  workflowId: string
  executionId: string
  status: string
  totalPauseCount: number
  resumedCount: number
  pausedAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  metadata: Record<string, any> | null
  triggerIds: string[]
  pausePoints: PausePointWithQueue[]
}

interface PauseContextDetail {
  execution: PausedExecutionSummary
  pausePoint: PausePointWithQueue
  queue: ResumeQueueEntrySummary[]
  activeResumeEntry?: ResumeQueueEntrySummary | null
}

interface ResumeClientProps {
  params: { workflowId: string; executionId: string; contextId: string }
  initialDetail: PauseContextDetail | null
}

const POLL_INTERVAL_MS = 5000

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export default function ResumeClientPage({ params, initialDetail }: ResumeClientProps) {
  const { workflowId, executionId, contextId } = params
  const router = useRouter()
  const brandConfig = useBrandConfig()

  const [detail, setDetail] = useState<PauseContextDetail | null>(initialDetail)
  const [status, setStatus] = useState(initialDetail?.pausePoint.resumeStatus ?? 'paused')
  const [queuePosition, setQueuePosition] = useState<number | null | undefined>(
    initialDetail?.pausePoint.queuePosition
  )
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')
  const [resumeInput, setResumeInput] = useState(() =>
    initialDetail?.pausePoint.response?.data
      ? JSON.stringify(initialDetail.pausePoint.response.data, null, 2)
      : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const pauseLinks = detail?.pausePoint.resumeLinks
  const resumeDisabled =
    loading || status === 'resumed' || status === 'failed' || status === 'resuming'

  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    const hadLight = root.classList.contains('light')
    root.classList.add('light')
    root.classList.remove('dark')
    return () => {
      if (!hadLight) root.classList.remove('light')
      if (hadDark) root.classList.add('dark')
    }
  }, [])

  useEffect(() => {
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()
      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }
    checkCustomBrand()
    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    setDetail(initialDetail)
    setStatus(initialDetail?.pausePoint.resumeStatus ?? 'paused')
    setQueuePosition(initialDetail?.pausePoint.queuePosition)
  }, [initialDetail])

  const refreshDetail = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/resume/${workflowId}/${executionId}/${contextId}`,
        {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        }
      )

      if (!response.ok) {
        return
      }

      const data: PauseContextDetail = await response.json()
      setDetail(data)
      setStatus(data.pausePoint.resumeStatus)
      setQueuePosition(data.pausePoint.queuePosition)
    } catch (err) {
      console.error('Failed to refresh pause context', err)
    }
  }, [workflowId, executionId, contextId])

  useEffect(() => {
    if (!detail) return
    if (status === 'resumed' || status === 'failed') {
      return
    }

    const interval = window.setInterval(() => {
      refreshDetail()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [detail, status, refreshDetail])

  const handleResume = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMessage(null)

    let parsedInput: any = undefined

    if (resumeInput && resumeInput.trim().length > 0) {
      try {
        parsedInput = JSON.parse(resumeInput)
      } catch (err: any) {
        setError('Resume input must be valid JSON.')
        setLoading(false)
        return
      }
    }

    try {
      const response = await fetch(`/api/resume/${workflowId}/${executionId}/${contextId}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsedInput ? { input: parsedInput } : {}),
      })

      const payload = await response.json()

      if (!response.ok) {
        setError(payload.error || 'Failed to resume execution.')
        setStatus(detail?.pausePoint.resumeStatus ?? 'paused')
        return
      }

      if (payload.status === 'queued') {
        setStatus('queued')
        setQueuePosition(payload.queuePosition)
        setMessage('Resume request queued. This page will refresh automatically.')
      } else {
        setStatus('resuming')
        setMessage('Resume execution started. Monitoring for completion...')
      }

      await refreshDetail()
    } catch (err: any) {
      setError(err.message || 'Unexpected error while resuming execution.')
    } finally {
      setLoading(false)
    }
  }, [resumeInput, workflowId, executionId, contextId, detail, refreshDetail])

  const statusLabel = useMemo(() => {
    if (status === 'queued') {
      if (queuePosition && queuePosition > 0) {
        return `Queued (position ${queuePosition})`
      }
      return 'Queued'
    }

    if (status === 'resuming') {
      return 'Resuming'
    }

    return status.charAt(0).toUpperCase() + status.slice(1)
  }, [status, queuePosition])

  if (!detail) {
    return (
      <div className='min-h-screen bg-white'>
        <Nav variant='auth' />
        <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
          <div className='w-full max-w-[410px]'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
                  Pause Not Found
                </h1>
                <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                  The pause you are trying to resume could not be located or has already completed.
                </p>
              </div>

              <div className='mt-8 w-full space-y-3'>
                <Button
                  type='button'
                  onClick={() => router.push('/')}
                  className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
                >
                  Return Home
                </Button>
              </div>

              <div
                className={`${inter.className} auth-text-muted fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
              >
                Need help?{' '}
                <a
                  href={`mailto:${brandConfig.supportEmail}`}
                  className='auth-link underline-offset-4 transition hover:underline'
                >
                  Contact support
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const pauseResponsePreview = useMemo(() => {
    try {
      return JSON.stringify(detail.pausePoint.response?.data ?? {}, null, 2)
    } catch {
      return String(detail.pausePoint.response?.data ?? '')
    }
  }, [detail.pausePoint.response])

  return (
    <div className='min-h-screen bg-white'>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4 py-8'>
        <div className='w-full max-w-[700px]'>
          <div className='space-y-6 rounded-[20px] border border-slate-200 bg-white p-8 shadow-sm'>
            <div className='space-y-2 text-center'>
              <h1 className={`${soehne.className} text-[32px] font-medium text-black tracking-tight`}>
                Workflow Paused
              </h1>
              <p className={`${inter.className} text-[16px] font-[380] text-muted-foreground`}>
                Provide input (optional) and resume the workflow execution.
              </p>
            </div>

            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
              <DetailRow label='Workflow ID' value={detail.execution.workflowId} />
              <DetailRow label='Execution ID' value={detail.execution.executionId} />
              <DetailRow label='Context ID' value={detail.pausePoint.contextId} />
              <DetailRow label='Status' value={statusLabel} />
              <DetailRow label='Registered At' value={formatDate(detail.pausePoint.registeredAt)} />
              <DetailRow label='Last Updated' value={formatDate(detail.execution.updatedAt)} />
            </div>

            {detail.pausePoint.resumeLinks && (
              <div className='rounded-xl bg-slate-100 p-4 text-left'>
                <h2 className={`${soehne.className} text-sm font-semibold text-slate-700`}>Shareable Links</h2>
                <p className={`${inter.className} mt-2 break-words text-sm text-slate-600`}>
                  UI: <span className='font-medium'>{detail.pausePoint.resumeLinks.uiUrl}</span>
                </p>
                <p className={`${inter.className} mt-1 break-words text-sm text-slate-600`}>
                  API: <span className='font-medium'>{detail.pausePoint.resumeLinks.apiUrl}</span>
                </p>
              </div>
            )}

            <div className='space-y-3 text-left'>
              <h2 className={`${soehne.className} text-sm font-semibold text-slate-700`}>
                Pause Response Preview
              </h2>
              <pre className='max-h-60 overflow-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100'>
                {pauseResponsePreview}
              </pre>
            </div>

            <div className='space-y-2 text-left'>
              <label className={`${soehne.className} text-sm font-semibold text-slate-700`}>
                Resume Input (JSON, optional)
              </label>
              <Textarea
                value={resumeInput}
                onChange={(event) => setResumeInput(event.target.value)}
                placeholder='{
  "example": "value"
}'
                className='min-h-[160px] resize-y rounded-xl border-slate-200 bg-white'
              />
            </div>

            {error && (
              <div className='rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700'>
                {error}
              </div>
            )}

            {message && (
              <div className='rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700'>
                {message}
              </div>
            )}

            <div className='flex flex-col gap-3 sm:flex-row sm:justify-between'>
              <Button
                type='button'
                onClick={handleResume}
                disabled={resumeDisabled}
                className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200 sm:w-auto`}
              >
                {loading ? 'Resuming…' : 'Resume Execution'}
              </Button>

              <div className='flex w-full items-center justify-between gap-3 sm:w-auto'>
                <Button
                  variant='outline'
                  type='button'
                  onClick={() => refreshDetail()}
                  className='flex-1 rounded-[10px] border-slate-200 font-medium text-[15px] sm:flex-none'
                >
                  Refresh
                </Button>
                <Button
                  variant='ghost'
                  type='button'
                  onClick={() => router.push('/')}
                  className='flex-1 rounded-[10px] font-medium text-[15px] text-slate-700 sm:flex-none'
                >
                  Home
                </Button>
              </div>
            </div>

            {detail.queue.length > 0 && (
              <div className='space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left'>
                <h2 className={`${soehne.className} text-sm font-semibold text-slate-700`}>
                  Resume Queue History
                </h2>
                <div className='space-y-3'>
                  {detail.queue.map((entry) => (
                    <div key={entry.id} className='rounded-lg border border-slate-200 bg-white p-3'>
                      <p className={`${inter.className} text-sm font-medium text-slate-700`}>
                        {entry.status.toUpperCase()} · {formatDate(entry.queuedAt)}
                      </p>
                      <p className={`${inter.className} mt-1 text-xs text-slate-500`}>
                        Resume Execution ID: {entry.newExecutionId}
                      </p>
                      {entry.failureReason && (
                        <p className={`${inter.className} mt-1 text-xs text-red-600`}>
                          Failure: {entry.failureReason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`${inter.className} auth-text-muted fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
      >
        Need help?{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='auth-link underline-offset-4 transition hover:underline'
        >
          Contact support
        </a>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className='rounded-xl border border-slate-200 bg-slate-50 p-3 text-left'>
      <p className={`${inter.className} text-xs uppercase tracking-wide text-slate-500`}>{label}</p>
      <p className={`${soehne.className} mt-1 text-sm font-semibold text-slate-800`}>{
        value ?? '—'
      }</p>
    </div>
  )
}
