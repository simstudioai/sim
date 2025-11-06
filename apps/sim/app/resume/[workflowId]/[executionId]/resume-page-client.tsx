'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
  parallelScope?: any
  loopScope?: any
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

interface PausedExecutionDetail extends PausedExecutionSummary {
  executionSnapshot: any
  queue: ResumeQueueEntrySummary[]
}

interface ResumeExecutionPageProps {
  params: { workflowId: string; executionId: string }
  initialExecutionDetail: PausedExecutionDetail | null
  initialContextId?: string | null
}

const RESUME_STATUS_STYLES: Record<string, string> = {
  paused: 'border-amber-200 bg-amber-50 text-amber-700',
  queued: 'border-blue-200 bg-blue-50 text-blue-700',
  resuming: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  resumed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function getStatusLabel(status: string): string {
  if (!status) return 'Unknown'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function ResumeStatusBadge({ status }: { status: string }) {
  const className = RESUME_STATUS_STYLES[status] ?? 'border-slate-200 bg-slate-100 text-slate-700'
  return (
    <Badge variant='outline' className={className}>
      {getStatusLabel(status)}
    </Badge>
  )
}

export default function ResumeExecutionPage({
  params,
  initialExecutionDetail,
  initialContextId,
}: ResumeExecutionPageProps) {
  const { workflowId, executionId } = params
  const router = useRouter()
  const brandConfig = useBrandConfig()

  const [executionDetail, setExecutionDetail] = useState<PausedExecutionDetail | null>(initialExecutionDetail)
  const totalPauses = executionDetail?.totalPauseCount ?? 0
  const resumedCount = executionDetail?.resumedCount ?? 0
  const pendingCount = Math.max(0, totalPauses - resumedCount)
  const pausePoints = executionDetail?.pausePoints ?? []

  const defaultContextId = useMemo(() => {
    if (initialContextId) return initialContextId
    return pausePoints.find((point) => point.resumeStatus === 'paused')?.contextId ?? pausePoints[0]?.contextId
  }, [initialContextId, pausePoints])
  const actionablePausePoints = useMemo(
    () => pausePoints.filter((point) => point.resumeStatus === 'paused'),
    [pausePoints]
  )

  const groupedPausePoints = useMemo(() => {
    const activeStatuses = new Set(['paused', 'queued', 'resuming'])
    const resolvedStatuses = new Set(['resumed', 'failed'])

    return {
      active: pausePoints.filter((point) => activeStatuses.has(point.resumeStatus)),
      resolved: pausePoints.filter((point) => resolvedStatuses.has(point.resumeStatus)),
    }
  }, [pausePoints])

  const [selectedContextId, setSelectedContextId] = useState<string | null>(defaultContextId ?? null)
  const [selectedDetail, setSelectedDetail] = useState<PauseContextDetail | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<PausePointWithQueue['resumeStatus']>('paused')
  const [queuePosition, setQueuePosition] = useState<number | null | undefined>(undefined)
  const [resumeInputs, setResumeInputs] = useState<Record<string, string>>({})
  const [resumeInput, setResumeInput] = useState('')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingAction, setLoadingAction] = useState(false)
  const [refreshingExecution, setRefreshingExecution] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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
    if (!selectedContextId) {
      setSelectedDetail(null)
      return
    }

    const controller = new AbortController()
    const loadDetail = async () => {
      setLoadingDetail(true)
      try {
        const response = await fetch(
          `/api/resume/${workflowId}/${executionId}/${selectedContextId}`,
          {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          }
        )

        if (!response.ok) {
          setSelectedDetail(null)
          return
        }

        const data: PauseContextDetail = await response.json()
        setSelectedDetail(data)
        setSelectedStatus(data.pausePoint.resumeStatus)
        setQueuePosition(data.pausePoint.queuePosition)

        setResumeInputs((prev) => {
          if (prev[data.pausePoint.contextId] !== undefined) {
            setResumeInput(prev[data.pausePoint.contextId])
            return prev
          }

          const initialValue = data.pausePoint.response?.data
            ? JSON.stringify(data.pausePoint.response.data, null, 2)
            : ''
          setResumeInput(initialValue)
          return { ...prev, [data.pausePoint.contextId]: initialValue }
        })
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          console.error('Failed to load pause context detail', err)
        }
      } finally {
        setLoadingDetail(false)
      }
    }

    loadDetail()
    return () => controller.abort()
  }, [workflowId, executionId, selectedContextId])

  const refreshExecutionDetail = useCallback(async () => {
    setRefreshingExecution(true)
    try {
      const response = await fetch(`/api/resume/${workflowId}/${executionId}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      })

      if (!response.ok) {
        return
      }

      const data: PausedExecutionDetail = await response.json()
      setExecutionDetail(data)

      if (!selectedContextId) {
        const first = data.pausePoints?.find((point: PausePointWithQueue) => point.resumeStatus === 'paused')?.contextId ?? null
        setSelectedContextId(first)
      }
    } catch (err) {
      console.error('Failed to refresh execution detail', err)
    } finally {
      setRefreshingExecution(false)
    }
  }, [workflowId, executionId, selectedContextId])

  const refreshSelectedDetail = useCallback(
    async (contextId: string, showLoader = true) => {
      try {
        if (showLoader) {
          setLoadingDetail(true)
        }
        const response = await fetch(`/api/resume/${workflowId}/${executionId}/${contextId}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })

        if (!response.ok) {
          return
        }

        const data: PauseContextDetail = await response.json()
        setSelectedDetail(data)
        setSelectedStatus(data.pausePoint.resumeStatus)
        setQueuePosition(data.pausePoint.queuePosition)
      } catch (err) {
        console.error('Failed to refresh pause context detail', err)
      } finally {
        if (showLoader) {
          setLoadingDetail(false)
        }
      }
    },
    [workflowId, executionId]
  )

  const handleResume = useCallback(async () => {
    if (!selectedContextId || !selectedDetail) return

    setLoadingAction(true)
    setError(null)
    setMessage(null)

    let parsedInput: any = undefined

    if (resumeInput && resumeInput.trim().length > 0) {
      try {
        parsedInput = JSON.parse(resumeInput)
      } catch (err: any) {
        setError('Resume input must be valid JSON.')
        setLoadingAction(false)
        return
      }
    }

    try {
      const response = await fetch(`/api/resume/${workflowId}/${executionId}/${selectedContextId}`, {
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
        setSelectedStatus(selectedDetail.pausePoint.resumeStatus)
        return
      }

      const nextStatus = payload.status === 'queued' ? 'queued' : 'resuming'
      const nextQueuePosition = payload.queuePosition ?? null

      const fallbackContextId = executionDetail?.pausePoints
        .find((point) => point.contextId !== selectedContextId && point.resumeStatus === 'paused')
        ?.contextId ?? null

      setExecutionDetail((prev) => {
        if (!prev) {
          return prev
        }

        return {
          ...prev,
          pausePoints: prev.pausePoints.map((point) =>
            point.contextId === selectedContextId
              ? {
                  ...point,
                  resumeStatus: nextStatus,
                  queuePosition: nextQueuePosition,
                }
              : point
          ),
        }
      })

      setSelectedDetail((prev) => {
        if (!prev || prev.pausePoint.contextId !== selectedContextId) {
          return prev
        }

        return {
          ...prev,
          pausePoint: {
            ...prev.pausePoint,
            resumeStatus: nextStatus,
            queuePosition: nextQueuePosition,
          },
        }
      })

      setSelectedStatus(nextStatus)
      setQueuePosition(nextQueuePosition)

      setSelectedContextId((prev) => {
        if (prev !== selectedContextId) {
          return prev
        }
        return fallbackContextId
      })

      if (payload.status === 'queued') {
        setMessage('Resume request queued. Use refresh to monitor its progress.')
      } else {
        setMessage('Resume execution started. Refresh to check for updates.')
      }

      await Promise.all([refreshExecutionDetail(), refreshSelectedDetail(selectedContextId, false)])
    } catch (err: any) {
      setError(err.message || 'Unexpected error while resuming execution.')
    } finally {
      setLoadingAction(false)
    }
  }, [
    workflowId,
    executionId,
    selectedContextId,
    resumeInput,
    selectedDetail,
    executionDetail,
    refreshExecutionDetail,
    refreshSelectedDetail,
  ])

  const pauseResponsePreview = useMemo(() => {
    if (!selectedDetail?.pausePoint.response?.data) return '{}'
    try {
      return JSON.stringify(selectedDetail.pausePoint.response.data, null, 2)
    } catch {
      return String(selectedDetail.pausePoint.response.data)
    }
  }, [selectedDetail])

  const statusDetailNode = useMemo(() => {
    return (
      <div className='flex flex-wrap items-center gap-2'>
        <ResumeStatusBadge status={selectedStatus} />
        {queuePosition && queuePosition > 0 ? (
          <span className={`${inter.className} text-xs text-slate-500`}>
            Queue position {queuePosition}
          </span>
        ) : null}
      </div>
    )
  }, [selectedStatus, queuePosition])

  const renderPausePointCard = useCallback(
    (pause: PausePointWithQueue, subdued = false) => {
      const isSelected = pause.contextId === selectedContextId
      const baseClasses = subdued
        ? 'border-slate-200 bg-slate-50 hover:border-slate-300'
        : 'border-slate-200 bg-white hover:border-primary/30'
      const selectedClasses = 'border-primary/50 bg-primary/5 shadow-sm'

      return (
        <button
          key={pause.contextId}
          type='button'
          onClick={() => {
            setSelectedContextId(pause.contextId)
            setError(null)
            setMessage(null)
          }}
          className={`w-full rounded-[16px] border p-4 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
            isSelected ? selectedClasses : baseClasses
          }`}
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='overflow-hidden'>
              <p className={`${soehne.className} truncate text-sm font-semibold text-slate-800`}>
                {pause.contextId}
              </p>
              <p className={`${inter.className} mt-1 text-xs text-muted-foreground`}>
                Registered {formatDate(pause.registeredAt)}
              </p>
              {pause.queuePosition != null && pause.queuePosition > 0 && (
                <p className={`${inter.className} mt-1 text-xs text-slate-500`}>
                  Queue position {pause.queuePosition}
                </p>
              )}
              {pause.resumeLinks?.uiUrl && (
                <p className={`${inter.className} mt-1 truncate text-xs text-slate-500`}>
                  UI link: <span className='font-medium'>{pause.resumeLinks.uiUrl}</span>
                </p>
              )}
            </div>
            <ResumeStatusBadge status={pause.resumeStatus} />
          </div>
        </button>
      )
    },
    [selectedContextId]
  )

  const resumeDisabled =
    loadingAction ||
    selectedStatus === 'resumed' ||
    selectedStatus === 'failed' ||
    selectedStatus === 'resuming' ||
    selectedStatus === 'queued'

  if (!executionDetail) {
    return (
      <div className='min-h-screen bg-white'>
        <Nav variant='auth' />
        <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
          <div className='w-full max-w-[410px]'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1 className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}>
                  Execution Not Found
                </h1>
                <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                  The execution you are trying to resume could not be located or has already completed.
                </p>
              </div>

              <div className='mt-8 w-full space-y-3'>
                <Button
                  type='button'
                  onClick={() => router.push('/')}
                  className='auth-button-gradient flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200'
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

  return (
    <div className='min-h-screen bg-white'>
      <Nav variant='auth' />
      <div className='mx-auto flex min-h-[calc(100vh-120px)] max-w-6xl flex-col gap-6 px-4 py-8 xl:flex-row'>
        <aside className='w-full space-y-4 xl:w-[320px]'>
          <div className='space-y-2 rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm'>
            <div className='space-y-1 text-left'>
              <h2 className={`${soehne.className} text-[22px] font-medium text-black tracking-tight`}>
                Paused Execution
              </h2>
              <p className={`${inter.className} text-[14px] text-muted-foreground`}>
                Manage all pauses for this execution from a single workspace.
              </p>
            </div>
            <div className='grid grid-cols-3 gap-3 text-center'>
              <SummaryStat label='Total Pauses' value={totalPauses} />
              <SummaryStat label='Resumed' value={resumedCount} />
              <SummaryStat label='Pending' value={pendingCount} />
            </div>
          </div>

          <div className='space-y-4 rounded-[20px] border border-slate-200 bg-white p-6 shadow-sm'>
            <div className='flex items-center justify-between'>
              <h3 className={`${soehne.className} text-[15px] font-semibold text-slate-800`}>
                Pause Points
              </h3>
              <Button
                variant='outline'
                size='sm'
                onClick={refreshExecutionDetail}
                disabled={refreshingExecution}
                className='rounded-[10px] border-slate-200'
              >
                {refreshingExecution ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>

            <div className='space-y-6'>
              <div>
                <p className={`${inter.className} text-xs uppercase tracking-wide text-slate-500`}>Active</p>
                {groupedPausePoints.active.length === 0 ? (
                  <p className={`${inter.className} mt-2 text-sm text-muted-foreground`}>
                    No active pauses right now. Resume requests will appear here when available.
                  </p>
                ) : (
                  <div className='mt-3 space-y-3'>
                    {groupedPausePoints.active.map((pause) => renderPausePointCard(pause))}
                  </div>
                )}
              </div>

              {groupedPausePoints.resolved.length > 0 && (
                <div className='border-t border-slate-200 pt-4'>
                  <p className={`${inter.className} text-xs uppercase tracking-wide text-slate-500`}>Completed</p>
                  <div className='mt-3 space-y-2'>
                    {groupedPausePoints.resolved.map((pause) => renderPausePointCard(pause, true))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className='flex-1'>
          <div className='space-y-6 rounded-[20px] border border-slate-200 bg-white p-8 shadow-sm'>
            {loadingDetail && !selectedDetail ? (
              <div className='flex h-32 items-center justify-center text-muted-foreground'>
                Loading pause details...
              </div>
            ) : !selectedContextId ? (
              <div className='flex h-32 items-center justify-center text-muted-foreground'>
                Select a pause point to view details.
              </div>
            ) : !selectedDetail ? (
              <div className='flex h-32 items-center justify-center text-muted-foreground'>
                Pause details could not be loaded.
              </div>
            ) : (
              <Fragment>
                <div className='space-y-2 text-left'>
                  <h1 className={`${soehne.className} text-[32px] font-medium text-black tracking-tight`}>
                    Pause Details
                  </h1>
                  <p className={`${inter.className} text-[16px] font-[380] text-muted-foreground`}>
                    Provide optional input and resume the selected pause.
                  </p>
                </div>

                <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                  <DetailRow label='Workflow ID' value={selectedDetail.execution.workflowId} />
                  <DetailRow label='Execution ID' value={selectedDetail.execution.executionId} />
                  <DetailRow label='Context ID' value={selectedDetail.pausePoint.contextId} />
                  <DetailRow label='Status' value={statusDetailNode} />
                  <DetailRow label='Registered At' value={formatDate(selectedDetail.pausePoint.registeredAt)} />
                  <DetailRow label='Last Updated' value={formatDate(selectedDetail.execution.updatedAt)} />
                </div>

                {selectedDetail.activeResumeEntry && (
                  <div className='rounded-xl border border-blue-200 bg-blue-50 p-4 text-left'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <h2 className={`${soehne.className} text-sm font-semibold text-blue-900`}>
                        Current Resume Attempt
                      </h2>
                      <ResumeStatusBadge status={selectedDetail.activeResumeEntry.status?.toLowerCase?.() ?? selectedDetail.activeResumeEntry.status} />
                    </div>
                    <div className='mt-3 space-y-1'>
                      <p className={`${inter.className} text-xs text-blue-800`}>
                        Resume execution ID: <span className='font-medium'>{selectedDetail.activeResumeEntry.newExecutionId}</span>
                      </p>
                      {selectedDetail.activeResumeEntry.claimedAt && (
                        <p className={`${inter.className} text-xs text-blue-800`}>
                          Started at {formatDate(selectedDetail.activeResumeEntry.claimedAt)}
                        </p>
                      )}
                      {selectedDetail.activeResumeEntry.completedAt && (
                        <p className={`${inter.className} text-xs text-blue-800`}>
                          Completed at {formatDate(selectedDetail.activeResumeEntry.completedAt)}
                        </p>
                      )}
                    </div>
                    {selectedDetail.activeResumeEntry.failureReason && (
                      <div className='mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700'>
                        {selectedDetail.activeResumeEntry.failureReason}
                      </div>
                    )}
                  </div>
                )}

                {selectedDetail.pausePoint.resumeLinks && (
                  <div className='rounded-xl bg-slate-100 p-4 text-left'>
                    <h2 className={`${soehne.className} text-sm font-semibold text-slate-700`}>Shareable Links</h2>
                    <p className={`${inter.className} mt-2 break-words text-sm text-slate-600`}>
                      UI: <span className='font-medium'>{selectedDetail.pausePoint.resumeLinks.uiUrl}</span>
                    </p>
                    <p className={`${inter.className} mt-1 break-words text-sm text-slate-600`}>
                      API: <span className='font-medium'>{selectedDetail.pausePoint.resumeLinks.apiUrl}</span>
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
                    onChange={(event) => {
                      setResumeInput(event.target.value)
                      if (selectedContextId) {
                        setResumeInputs((prev) => ({ ...prev, [selectedContextId]: event.target.value }))
                      }
                    }}
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
                    className='auth-button-gradient flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200 sm:w-auto'
                  >
                    {loadingAction ? 'Resuming…' : 'Resume Execution'}
                  </Button>

                  <div className='flex w-full items-center justify-between gap-3 sm:w-auto'>
                    <Button
                      variant='outline'
                      type='button'
                      onClick={() => {
                        if (selectedContextId) {
                          refreshSelectedDetail(selectedContextId)
                        }
                      }}
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

                {selectedDetail.queue.length > 0 && (
                  <div className='space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left'>
                    <h2 className={`${soehne.className} text-sm font-semibold text-slate-700`}>
                      Resume Attempts
                    </h2>
                    <div className='space-y-3'>
                      {selectedDetail.queue.map((entry) => {
                        const normalizedStatus = entry.status?.toLowerCase?.() ?? entry.status
                        return (
                          <div key={entry.id} className='rounded-xl border border-slate-200 bg-white p-4'>
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                              <ResumeStatusBadge status={normalizedStatus} />
                              <span className={`${inter.className} text-xs text-slate-500`}>
                                {formatDate(entry.queuedAt)}
                              </span>
                            </div>
                            <div className='mt-3 space-y-1'>
                              <p className={`${inter.className} text-xs text-slate-500`}>
                                Resume execution ID: <span className='font-medium text-slate-700'>{entry.newExecutionId}</span>
                              </p>
                              {entry.claimedAt && (
                                <p className={`${inter.className} text-xs text-slate-500`}>
                                  Started at <span className='font-medium text-slate-700'>{formatDate(entry.claimedAt)}</span>
                                </p>
                              )}
                              {entry.completedAt && (
                                <p className={`${inter.className} text-xs text-slate-500`}>
                                  Completed at <span className='font-medium text-slate-700'>{formatDate(entry.completedAt)}</span>
                                </p>
                              )}
                            </div>
                            {entry.failureReason && (
                              <div className='mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700'>
                                {entry.failureReason}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </Fragment>
            )}
          </div>
        </main>
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

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-[14px] border border-slate-200 bg-slate-50 p-3'>
      <p className={`${inter.className} text-[11px] uppercase tracking-wide text-slate-500`}>{label}</p>
      <p className={`${soehne.className} mt-1 text-[18px] font-semibold text-slate-800`}>{value}</p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  const shouldShowPlaceholder =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim().length === 0)
  const displayValue = shouldShowPlaceholder ? '—' : value

  return (
    <div className='rounded-xl border border-slate-200 bg-slate-50 p-3 text-left'>
      <p className={`${inter.className} text-xs uppercase tracking-wide text-slate-500`}>{label}</p>
      <div className={`${soehne.className} mt-1 text-sm font-semibold text-slate-800`}>{displayValue}</div>
    </div>
  )
}
