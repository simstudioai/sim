'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Textarea } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useBrandConfig } from '@/lib/branding/branding'
import { cn } from '@/lib/core/utils/cn'
import Nav from '@/app/(landing)/components/nav/nav'
import type { ResumeStatus } from '@/executor/types'

interface ResumeLinks {
  apiUrl: string
  uiUrl: string
  contextId: string
  executionId: string
  workflowId: string
}

interface NormalizedInputField {
  id: string
  name: string
  label: string
  type: string
  description?: string
  placeholder?: string
  value?: any
  required?: boolean
  options?: any[]
  rows?: number
}

interface ResponseStructureRow {
  id: string
  name: string
  type: string
  value: any
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
  resumeStatus: ResumeStatus
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
  paused: 'border-[var(--c-F59E0B)]/30 bg-[var(--c-F59E0B)]/10 text-[var(--c-F59E0B)]',
  queued:
    'border-[var(--brand-tertiary)]/30 bg-[var(--brand-tertiary)]/10 text-[var(--brand-tertiary)]',
  resuming:
    'border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]',
  resumed: 'border-[var(--text-success)]/30 bg-[var(--text-success)]/10 text-[var(--text-success)]',
  failed: 'border-[var(--text-error)]/30 bg-[var(--text-error)]/10 text-[var(--text-error)]',
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
  const style =
    RESUME_STATUS_STYLES[status] ??
    'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
  return (
    <Badge variant='outline' className={cn(style)}>
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

  const [executionDetail, setExecutionDetail] = useState<PausedExecutionDetail | null>(
    initialExecutionDetail
  )
  const totalPauses = executionDetail?.totalPauseCount ?? 0
  const resumedCount = executionDetail?.resumedCount ?? 0
  const pendingCount = Math.max(0, totalPauses - resumedCount)
  const pausePoints = executionDetail?.pausePoints ?? []

  const defaultContextId = useMemo(() => {
    if (initialContextId) return initialContextId
    return (
      pausePoints.find((point) => point.resumeStatus === 'paused')?.contextId ??
      pausePoints[0]?.contextId
    )
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

  const [selectedContextId, setSelectedContextId] = useState<string | null>(
    defaultContextId ?? null
  )
  const [selectedDetail, setSelectedDetail] = useState<PauseContextDetail | null>(null)
  const [selectedStatus, setSelectedStatus] =
    useState<PausePointWithQueue['resumeStatus']>('paused')
  const [queuePosition, setQueuePosition] = useState<number | null | undefined>(undefined)
  const [resumeInputs, setResumeInputs] = useState<Record<string, string>>({})
  const [resumeInput, setResumeInput] = useState('')
  const [formValuesByContext, setFormValuesByContext] = useState<
    Record<string, Record<string, string>>
  >({})
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingAction, setLoadingAction] = useState(false)
  const [refreshingExecution, setRefreshingExecution] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const normalizeInputFormatFields = useCallback((raw: any): NormalizedInputField[] => {
    if (!Array.isArray(raw)) return []

    return raw
      .map((field: any, index: number) => {
        if (!field || typeof field !== 'object') return null

        const name = typeof field.name === 'string' ? field.name.trim() : ''
        if (!name) return null

        const id = typeof field.id === 'string' && field.id.length > 0 ? field.id : `field_${index}`
        const label =
          typeof field.label === 'string' && field.label.trim().length > 0
            ? field.label.trim()
            : name
        const type =
          typeof field.type === 'string' && field.type.trim().length > 0 ? field.type : 'string'
        const description =
          typeof field.description === 'string' && field.description.trim().length > 0
            ? field.description.trim()
            : undefined
        const placeholder =
          typeof field.placeholder === 'string' && field.placeholder.trim().length > 0
            ? field.placeholder.trim()
            : undefined
        const required = field.required === true
        const options = Array.isArray(field.options) ? field.options : undefined
        const rows = typeof field.rows === 'number' ? field.rows : undefined

        return {
          id,
          name,
          label,
          type,
          description,
          placeholder,
          value: field.value,
          required,
          options,
          rows,
        } as NormalizedInputField
      })
      .filter((field): field is NormalizedInputField => field !== null)
  }, [])

  const formatValueForInputField = useCallback(
    (field: NormalizedInputField, value: any): string => {
      if (value === undefined || value === null) {
        return ''
      }

      switch (field.type) {
        case 'boolean':
          if (typeof value === 'boolean') {
            return value ? 'true' : 'false'
          }
          if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase()
            if (normalized === 'true' || normalized === 'false') {
              return normalized
            }
          }
          return ''
        case 'number':
          if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : ''
          }
          if (typeof value === 'string') {
            return value
          }
          return ''
        case 'array':
        case 'object':
        case 'files':
          if (typeof value === 'string') {
            return value
          }
          try {
            return JSON.stringify(value, null, 2)
          } catch {
            return ''
          }
        default:
          return typeof value === 'string' ? value : JSON.stringify(value)
      }
    },
    []
  )

  const buildInitialFormValues = useCallback(
    (fields: NormalizedInputField[], submission?: Record<string, any>) => {
      const initial: Record<string, string> = {}

      for (const field of fields) {
        const candidate =
          submission && Object.hasOwn(submission, field.name) ? submission[field.name] : field.value

        initial[field.name] = formatValueForInputField(field, candidate)
      }

      return initial
    },
    [formatValueForInputField]
  )

  const formatStructureValue = useCallback((value: any): string => {
    if (value === null || value === undefined) return '—'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [])

  const parseFormValue = useCallback(
    (field: NormalizedInputField, rawValue: string): { value: any; error?: string } => {
      const value = rawValue ?? ''

      switch (field.type) {
        case 'number': {
          if (!value.trim()) {
            return { value: null }
          }
          const numericValue = Number(value)
          if (Number.isNaN(numericValue)) {
            return { value: null, error: 'Enter a valid number.' }
          }
          return { value: numericValue }
        }
        case 'boolean': {
          if (value === 'true') return { value: true }
          if (value === 'false') return { value: false }
          if (!value) return { value: null }
          return { value: null, error: 'Select true or false.' }
        }
        case 'array':
        case 'object':
        case 'files': {
          if (!value.trim()) {
            if (field.type === 'array') return { value: [] }
            return { value: {} }
          }
          try {
            return { value: JSON.parse(value) }
          } catch {
            return { value: null, error: 'Enter valid JSON.' }
          }
        }
        default:
          return { value }
      }
    },
    []
  )

  const handleFormFieldChange = useCallback(
    (fieldName: string, newValue: string) => {
      if (!selectedContextId) return

      setFormValues((prev) => {
        const updated = { ...prev, [fieldName]: newValue }
        setFormValuesByContext((map) => ({ ...map, [selectedContextId]: updated }))
        return updated
      })

      setFormErrors((prev) => {
        if (!prev[fieldName]) {
          return prev
        }
        const { [fieldName]: _, ...rest } = prev
        return rest
      })
    },
    [selectedContextId]
  )

  const renderFieldInput = useCallback(
    (field: NormalizedInputField) => {
      const value = formValues[field.name] ?? ''

      switch (field.type) {
        case 'boolean': {
          const selectValue = value === 'true' || value === 'false' ? value : '__unset__'
          return (
            <Select
              value={selectValue}
              onValueChange={(val) => handleFormFieldChange(field.name, val)}
            >
              <SelectTrigger className='w-full rounded-[6px] border-[var(--border)] bg-[var(--surface-1)]'>
                <SelectValue
                  placeholder={
                    field.required ? 'Select true or false' : 'Select true, false, or leave blank'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {!field.required && <SelectItem value='__unset__'>Not set</SelectItem>}
                <SelectItem value='true'>True</SelectItem>
                <SelectItem value='false'>False</SelectItem>
              </SelectContent>
            </Select>
          )
        }
        case 'number':
          return (
            <Input
              type='number'
              value={value}
              onChange={(event) => handleFormFieldChange(field.name, event.target.value)}
              placeholder={field.placeholder ?? 'Enter a number...'}
            />
          )
        case 'array':
        case 'object':
        case 'files':
          return (
            <Textarea
              value={value}
              onChange={(event) => handleFormFieldChange(field.name, event.target.value)}
              placeholder={field.placeholder ?? (field.type === 'array' ? '[...]' : '{...}')}
              className='min-h-[120px] font-mono text-[13px]'
            />
          )
        default: {
          const useTextarea = field.rows !== undefined && field.rows > 3
          if (useTextarea) {
            return (
              <Textarea
                value={value}
                onChange={(event) => handleFormFieldChange(field.name, event.target.value)}
                placeholder={field.placeholder ?? 'Enter value...'}
                className='min-h-[120px]'
              />
            )
          }
          return (
            <Input
              value={value}
              onChange={(event) => handleFormFieldChange(field.name, event.target.value)}
              placeholder={field.placeholder ?? 'Enter value...'}
            />
          )
        }
      }
    },
    [formValues, handleFormFieldChange]
  )

  const selectedOperation = useMemo(
    () => selectedDetail?.pausePoint.response?.data?.operation || 'human',
    [selectedDetail]
  )
  const isHumanMode = selectedOperation === 'human'

  const inputFormatFields = useMemo(
    () => normalizeInputFormatFields(selectedDetail?.pausePoint.response?.data?.inputFormat),
    [normalizeInputFormatFields, selectedDetail]
  )
  const hasInputFormat = inputFormatFields.length > 0

  const responseStructureRows = useMemo<ResponseStructureRow[]>(() => {
    const raw = selectedDetail?.pausePoint.response?.data?.responseStructure
    if (!Array.isArray(raw)) return []

    return raw
      .map((entry: any, index: number) => {
        if (!entry || typeof entry !== 'object') return null
        const name =
          typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : `field_${index}`
        const type =
          typeof entry.type === 'string' && entry.type.length > 0
            ? entry.type
            : Array.isArray(entry.value)
              ? 'array'
              : typeof entry.value

        return {
          id: entry.id ?? `${name}_${index}`,
          name,
          type,
          value: entry.value,
        } as ResponseStructureRow
      })
      .filter((row): row is ResponseStructureRow => row !== null)
  }, [selectedDetail])

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
        const responseData = data.pausePoint.response?.data ?? {}
        const operation = responseData.operation || 'human'
        const fetchedInputFields = normalizeInputFormatFields(responseData.inputFormat)
        const submission =
          responseData &&
          typeof responseData.submission === 'object' &&
          !Array.isArray(responseData.submission)
            ? (responseData.submission as Record<string, any>)
            : undefined

        if (operation === 'human' && fetchedInputFields.length > 0) {
          const baseValues = buildInitialFormValues(fetchedInputFields, submission)
          let mergedValues = baseValues
          setFormValuesByContext((prev) => {
            const existingValues = prev[data.pausePoint.contextId]
            if (existingValues) {
              mergedValues = { ...baseValues, ...existingValues }
            }
            return { ...prev, [data.pausePoint.contextId]: mergedValues }
          })
          setFormValues(mergedValues)
          setFormErrors({})
          setResumeInputs((prev) => {
            if (prev[data.pausePoint.contextId] !== undefined) {
              const next = { ...prev }
              delete next[data.pausePoint.contextId]
              return next
            }
            return prev
          })
          setResumeInput('')
        } else {
          const initialValue =
            typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData ?? {}, null, 2)
          setResumeInputs((prev) => {
            if (prev[data.pausePoint.contextId] !== undefined) {
              setResumeInput(prev[data.pausePoint.contextId])
              return prev
            }
            setResumeInput(initialValue)
            return { ...prev, [data.pausePoint.contextId]: initialValue }
          })
          setFormValues({})
          setFormErrors({})
        }
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
  }, [
    workflowId,
    executionId,
    selectedContextId,
    normalizeInputFormatFields,
    buildInitialFormValues,
  ])

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
        const first =
          data.pausePoints?.find((point: PausePointWithQueue) => point.resumeStatus === 'paused')
            ?.contextId ?? null
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

        const responseData = data.pausePoint.response?.data ?? {}
        const operation = responseData.operation || 'human'
        const fetchedInputFields = normalizeInputFormatFields(responseData.inputFormat)
        const submission =
          responseData &&
          typeof responseData.submission === 'object' &&
          !Array.isArray(responseData.submission)
            ? (responseData.submission as Record<string, any>)
            : undefined

        if (operation === 'human' && fetchedInputFields.length > 0) {
          const baseValues = buildInitialFormValues(fetchedInputFields, submission)
          let mergedValues = baseValues
          setFormValuesByContext((prev) => {
            const existingValues = prev[data.pausePoint.contextId]
            if (existingValues) {
              mergedValues = { ...baseValues, ...existingValues }
            }
            return { ...prev, [data.pausePoint.contextId]: mergedValues }
          })
          setFormValues(mergedValues)
          setFormErrors({})
          setResumeInputs((prev) => {
            if (prev[data.pausePoint.contextId] !== undefined) {
              const next = { ...prev }
              delete next[data.pausePoint.contextId]
              return next
            }
            return prev
          })
          setResumeInput('')
        } else {
          const initialValue =
            typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData ?? {}, null, 2)
          setResumeInputs((prev) => {
            if (prev[data.pausePoint.contextId] !== undefined) {
              setResumeInput(prev[data.pausePoint.contextId])
              return prev
            }
            setResumeInput(initialValue)
            return { ...prev, [data.pausePoint.contextId]: initialValue }
          })
          setFormValues({})
          setFormErrors({})
        }
      } catch (err) {
        console.error('Failed to refresh pause context detail', err)
      } finally {
        if (showLoader) {
          setLoadingDetail(false)
        }
      }
    },
    [workflowId, executionId, normalizeInputFormatFields, buildInitialFormValues]
  )

  const handleResume = useCallback(async () => {
    if (!selectedContextId || !selectedDetail) return

    setLoadingAction(true)
    setError(null)
    setMessage(null)

    let resumePayload: any

    if (isHumanMode && hasInputFormat) {
      const errors: Record<string, string> = {}
      const submission: Record<string, any> = {}

      for (const field of inputFormatFields) {
        const rawValue = formValues[field.name] ?? ''
        const hasValue =
          field.type === 'boolean'
            ? rawValue === 'true' || rawValue === 'false'
            : rawValue.trim().length > 0 && rawValue !== '__unset__'

        if (!hasValue || rawValue === '__unset__') {
          if (field.required) {
            errors[field.name] = 'This field is required.'
          }
          continue
        }

        const { value, error: parseError } = parseFormValue(field, rawValue)
        if (parseError) {
          errors[field.name] = parseError
          continue
        }

        if (value !== undefined) {
          submission[field.name] = value
        }
      }

      if (Object.keys(errors).length > 0) {
        setFormErrors(errors)
        setLoadingAction(false)
        return
      }

      setFormErrors({})
      resumePayload = { submission }
    } else {
      let parsedInput: any

      if (resumeInput && resumeInput.trim().length > 0) {
        try {
          parsedInput = JSON.parse(resumeInput)
        } catch (err: any) {
          setError('Resume input must be valid JSON.')
          setLoadingAction(false)
          return
        }
      }

      resumePayload = parsedInput
    }

    try {
      const response = await fetch(
        `/api/resume/${workflowId}/${executionId}/${selectedContextId}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(resumePayload ? { input: resumePayload } : {}),
        }
      )

      const payload = await response.json()

      if (!response.ok) {
        setError(payload.error || 'Failed to resume execution.')
        setSelectedStatus(selectedDetail.pausePoint.resumeStatus)
        return
      }

      const nextStatus = payload.status === 'queued' ? 'queued' : 'resuming'
      const nextQueuePosition = payload.queuePosition ?? null

      const fallbackContextId =
        executionDetail?.pausePoints.find(
          (point) => point.contextId !== selectedContextId && point.resumeStatus === 'paused'
        )?.contextId ?? null

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
    isHumanMode,
    hasInputFormat,
    inputFormatFields,
    formValues,
    parseFormValue,
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
      <div className='flex flex-wrap items-center gap-[8px]'>
        <ResumeStatusBadge status={selectedStatus} />
        {queuePosition && queuePosition > 0 ? (
          <span className='text-[12px] text-[var(--text-muted)]'>
            Queue position {queuePosition}
          </span>
        ) : null}
      </div>
    )
  }, [selectedStatus, queuePosition])

  const renderPausePointCard = useCallback(
    (pause: PausePointWithQueue, subdued = false) => {
      const isSelected = pause.contextId === selectedContextId

      return (
        <button
          key={pause.contextId}
          type='button'
          onClick={() => {
            setSelectedContextId(pause.contextId)
            setError(null)
            setMessage(null)
          }}
          className={cn(
            'w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] p-[12px] text-left',
            'hover:bg-[var(--surface-3)] focus:outline-none',
            isSelected && 'bg-[var(--surface-3)]'
          )}
        >
          <div className='mb-[8px] flex items-center justify-between'>
            <ResumeStatusBadge status={pause.resumeStatus} />
            <span className='truncate font-medium text-[11px] text-[var(--text-primary)]'>
              {pause.contextId}
            </span>
          </div>
          <div className='space-y-[4px] text-[11px] text-[var(--text-secondary)]'>
            <p>Registered: {formatDate(pause.registeredAt)}</p>
            {pause.queuePosition != null && pause.queuePosition > 0 && (
              <p className='text-[var(--c-F59E0B)]'>Queue Position: {pause.queuePosition}</p>
            )}
          </div>
        </button>
      )
    },
    [selectedContextId]
  )

  const isFormComplete = useMemo(() => {
    if (!isHumanMode || !hasInputFormat) return true

    return inputFormatFields.every((field) => {
      const rawValue = formValues[field.name] ?? ''

      if (field.type === 'boolean') {
        if (field.required) {
          return rawValue === 'true' || rawValue === 'false'
        }
        return rawValue === '' || rawValue === 'true' || rawValue === 'false'
      }

      if (!field.required) {
        return true
      }

      return rawValue.trim().length > 0
    })
  }, [isHumanMode, hasInputFormat, inputFormatFields, formValues])

  const resumeDisabled =
    loadingAction ||
    selectedStatus === 'resumed' ||
    selectedStatus === 'failed' ||
    selectedStatus === 'resuming' ||
    selectedStatus === 'queued' ||
    (isHumanMode && hasInputFormat && (!isFormComplete || Object.keys(formErrors).length > 0))

  if (!executionDetail) {
    return (
      <div className='relative min-h-screen bg-[var(--bg)]'>
        <Nav variant='auth' />
        <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-[16px]'>
          <div className='w-full max-w-[410px]'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-[4px] text-center'>
                <h1 className='font-medium text-[24px] text-[var(--text-primary)] tracking-tight'>
                  Execution Not Found
                </h1>
                <p className='text-[14px] text-[var(--text-secondary)]'>
                  The execution you are trying to resume could not be located or has already
                  completed.
                </p>
              </div>

              <div className='mt-[24px] w-full space-y-[12px]'>
                <Button
                  type='button'
                  onClick={() => router.push('/')}
                  variant='tertiary'
                  className='w-full'
                >
                  Return Home
                </Button>
              </div>

              <div className='fixed right-0 bottom-0 left-0 z-50 pb-[32px] text-center text-[13px] text-[var(--text-muted)]'>
                Need help?{' '}
                <a
                  href={`mailto:${brandConfig.supportEmail}`}
                  className='text-[var(--text-secondary)] underline-offset-4 transition hover:underline'
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
    <div className='relative min-h-screen bg-[var(--bg)]'>
      <Nav variant='auth' />
      <div className='mx-auto min-h-[calc(100vh-120px)] max-w-7xl px-[24px] py-[24px]'>
        {/* Header Section */}
        <div className='mb-[24px]'>
          <div className='flex items-center justify-between'>
            <div>
              <h1 className='font-medium text-[18px] text-[var(--text-primary)] tracking-tight'>
                Paused Execution
              </h1>
              <p className='mt-[4px] text-[13px] text-[var(--text-secondary)]'>
                Review and manage execution pause points
              </p>
            </div>
            <Button
              variant='outline'
              onClick={refreshExecutionDetail}
              disabled={refreshingExecution}
            >
              {refreshingExecution ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className='mb-[24px] grid grid-cols-1 gap-[16px] sm:grid-cols-3'>
          <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
            <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
              <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                Total Pauses
              </span>
            </div>
            <div className='px-[16px] py-[16px]'>
              <p className='font-semibold text-[28px] text-[var(--text-primary)]'>{totalPauses}</p>
            </div>
          </div>

          <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
            <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
              <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Resumed</span>
            </div>
            <div className='px-[16px] py-[16px]'>
              <p className='font-semibold text-[28px] text-[var(--text-success)]'>{resumedCount}</p>
            </div>
          </div>

          <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
            <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
              <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Pending</span>
            </div>
            <div className='px-[16px] py-[16px]'>
              <p className='font-semibold text-[28px] text-[var(--c-F59E0B)]'>{pendingCount}</p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className='grid grid-cols-1 gap-[24px] lg:grid-cols-3'>
          {/* Left Column: Pause Points + History */}
          <div className='space-y-[24px] lg:col-span-1'>
            {/* Pause Points List */}
            <div className='flex h-fit flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
              <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[12px]'>
                <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>Pause Points</h2>
                <p className='mt-[2px] text-[12px] text-[var(--text-muted)]'>
                  Select a pause point to view details
                </p>
              </div>
              <div className='space-y-[12px] p-[16px]'>
                {groupedPausePoints.active.length === 0 &&
                groupedPausePoints.resolved.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-[32px] text-center'>
                    <p className='text-[13px] text-[var(--text-secondary)]'>
                      No pause points found
                    </p>
                  </div>
                ) : (
                  <>
                    {groupedPausePoints.active.length > 0 && (
                      <div className='space-y-[12px]'>
                        <h3 className='font-medium text-[11px] text-[var(--text-muted)] uppercase tracking-wider'>
                          Active
                        </h3>
                        <div className='space-y-[8px]'>
                          {groupedPausePoints.active.map((pause) => renderPausePointCard(pause))}
                        </div>
                      </div>
                    )}

                    {groupedPausePoints.resolved.length > 0 && (
                      <>
                        {groupedPausePoints.active.length > 0 && (
                          <Separator className='my-[16px]' />
                        )}
                        <div className='space-y-[12px]'>
                          <h3 className='font-medium text-[11px] text-[var(--text-muted)] uppercase tracking-wider'>
                            Completed
                          </h3>
                          <div className='space-y-[8px]'>
                            {groupedPausePoints.resolved.map((pause) =>
                              renderPausePointCard(pause, true)
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* History */}
            {selectedDetail && (
              <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[12px]'>
                  <h2 className='font-medium text-[14px] text-[var(--text-primary)]'>
                    Resume History
                  </h2>
                  <p className='mt-[2px] text-[12px] text-[var(--text-muted)]'>
                    Previous resume attempts for this pause
                  </p>
                </div>
                <div className='p-[16px]'>
                  {selectedDetail.queue.length > 0 ? (
                    <div className='space-y-[12px]'>
                      {selectedDetail.queue.map((entry) => {
                        const normalizedStatus = entry.status?.toLowerCase?.() ?? entry.status
                        return (
                          <div
                            key={entry.id}
                            className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] p-[12px]'
                          >
                            <div className='mb-[8px] flex items-center justify-between'>
                              <ResumeStatusBadge status={normalizedStatus} />
                              <span className='font-medium text-[11px] text-[var(--text-primary)]'>
                                {entry.newExecutionId}
                              </span>
                            </div>
                            <div className='space-y-[4px] text-[11px] text-[var(--text-secondary)]'>
                              <p>Queued: {formatDate(entry.queuedAt)}</p>
                              {entry.claimedAt && (
                                <p>Execution Started: {formatDate(entry.claimedAt)}</p>
                              )}
                              {entry.completedAt && (
                                <p>Execution Completed: {formatDate(entry.completedAt)}</p>
                              )}
                            </div>
                            {entry.failureReason && (
                              <p className='mt-[8px] text-[11px] text-[var(--text-error)]'>
                                {entry.failureReason}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className='flex flex-col items-center justify-center py-[32px] text-center'>
                      <p className='text-[13px] text-[var(--text-secondary)]'>
                        No resume attempts yet
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Content + Input */}
          <div className='space-y-[24px] lg:col-span-2'>
            {loadingDetail && !selectedDetail ? (
              <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                <div className='flex h-[256px] items-center justify-center p-[24px]'>
                  <p className='text-[13px] text-[var(--text-secondary)]'>
                    Loading pause details...
                  </p>
                </div>
              </div>
            ) : !selectedContextId ? (
              <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                <div className='flex h-[256px] items-center justify-center p-[24px]'>
                  <p className='text-[13px] text-[var(--text-secondary)]'>
                    Select a pause point to view details
                  </p>
                </div>
              </div>
            ) : !selectedDetail ? (
              <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                <div className='flex h-[256px] items-center justify-center p-[24px]'>
                  <p className='text-[13px] text-[var(--text-secondary)]'>
                    Pause details could not be loaded
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Header with Status */}
                <div className='flex items-center justify-between'>
                  <div>
                    <h2 className='font-medium text-[16px] text-[var(--text-primary)]'>
                      Pause Details
                    </h2>
                    <p className='mt-[4px] text-[13px] text-[var(--text-secondary)]'>
                      Review content and provide input to resume
                    </p>
                  </div>
                  {statusDetailNode}
                </div>

                {/* Active Resume Entry Alert */}
                {selectedDetail.activeResumeEntry && (
                  <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--brand-tertiary)]/30 bg-[var(--brand-tertiary)]/5'>
                    <div className='flex items-center justify-between bg-[var(--brand-tertiary)]/10 px-[16px] py-[10px]'>
                      <h3 className='font-medium text-[13px] text-[var(--brand-tertiary)]'>
                        Current Resume Attempt
                      </h3>
                      <ResumeStatusBadge
                        status={
                          selectedDetail.activeResumeEntry.status?.toLowerCase?.() ??
                          selectedDetail.activeResumeEntry.status
                        }
                      />
                    </div>
                    <div className='space-y-[4px] p-[16px] text-[13px] text-[var(--text-secondary)]'>
                      <p>
                        Execution ID:{' '}
                        <span className='font-medium text-[var(--text-primary)]'>
                          {selectedDetail.activeResumeEntry.newExecutionId}
                        </span>
                      </p>
                      {selectedDetail.activeResumeEntry.claimedAt && (
                        <p>
                          Execution Started:{' '}
                          {formatDate(selectedDetail.activeResumeEntry.claimedAt)}
                        </p>
                      )}
                      {selectedDetail.activeResumeEntry.completedAt && (
                        <p>
                          Execution Completed:{' '}
                          {formatDate(selectedDetail.activeResumeEntry.completedAt)}
                        </p>
                      )}
                      {selectedDetail.activeResumeEntry.failureReason && (
                        <p className='mt-[8px] text-[12px] text-[var(--text-error)]'>
                          {selectedDetail.activeResumeEntry.failureReason}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Content Section */}
                {responseStructureRows.length > 0 ? (
                  <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                    <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
                      <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                        Content
                      </h3>
                    </div>
                    <div className='p-[16px]'>
                      <div className='overflow-hidden rounded-[6px] border border-[var(--border)]'>
                        <table className='min-w-full divide-y divide-[var(--border)]'>
                          <thead>
                            <tr className='border-[var(--border)] border-b bg-[var(--surface-3)]'>
                              <th className='px-[16px] py-[8px] text-left font-medium text-[11px] text-[var(--text-secondary)]'>
                                Field
                              </th>
                              <th className='px-[16px] py-[8px] text-left font-medium text-[11px] text-[var(--text-secondary)]'>
                                Type
                              </th>
                              <th className='px-[16px] py-[8px] text-left font-medium text-[11px] text-[var(--text-secondary)]'>
                                Value
                              </th>
                            </tr>
                          </thead>
                          <tbody className='divide-y divide-[var(--border)]'>
                            {responseStructureRows.map((row) => (
                              <tr key={row.id}>
                                <td className='px-[16px] py-[8px] font-medium text-[13px] text-[var(--text-primary)]'>
                                  {row.name}
                                </td>
                                <td className='px-[16px] py-[8px] text-[13px] text-[var(--text-secondary)]'>
                                  {row.type}
                                </td>
                                <td className='px-[16px] py-[8px]'>
                                  <pre className='max-h-[128px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-secondary)]'>
                                    {formatStructureValue(row.value)}
                                  </pre>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                    <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
                      <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                        Pause Response Data
                      </h3>
                    </div>
                    <div className='p-[16px]'>
                      <pre className='max-h-[240px] overflow-auto rounded-[6px] bg-[#1e1e1e] p-[16px] font-mono text-[#d4d4d4] text-[12px]'>
                        {pauseResponsePreview}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Input Section */}
                {isHumanMode && hasInputFormat ? (
                  <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                    <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
                      <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                        Resume Form
                      </h3>
                      <p className='mt-[2px] text-[12px] text-[var(--text-muted)]'>
                        Fill out the required fields to resume execution
                      </p>
                    </div>
                    <div className='space-y-[16px] p-[16px]'>
                      {inputFormatFields.map((field) => (
                        <div key={field.id} className='space-y-[6px]'>
                          <Label className='font-medium text-[13px] text-[var(--text-primary)]'>
                            {field.label}
                            {field.required && (
                              <span className='ml-[4px] text-[var(--text-error)]'>*</span>
                            )}
                          </Label>
                          {field.description && (
                            <p className='text-[12px] text-[var(--text-muted)]'>
                              {field.description}
                            </p>
                          )}
                          {renderFieldInput(field)}
                          {formErrors[field.name] && (
                            <p className='text-[12px] text-[var(--text-error)]'>
                              {formErrors[field.name]}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className='flex flex-col overflow-hidden rounded-[6px] border border-[var(--border)]'>
                    <div className='border-[var(--border)] border-b bg-[var(--surface-3)] px-[16px] py-[10px]'>
                      <h3 className='font-medium text-[13px] text-[var(--text-primary)]'>
                        Resume Input (JSON)
                      </h3>
                      <p className='mt-[2px] text-[12px] text-[var(--text-muted)]'>
                        Provide optional JSON input to pass to the resumed execution
                      </p>
                    </div>
                    <div className='p-[16px]'>
                      <Textarea
                        id='resume-input-textarea'
                        value={resumeInput}
                        onChange={(event) => {
                          setResumeInput(event.target.value)
                          if (selectedContextId) {
                            setResumeInputs((prev) => ({
                              ...prev,
                              [selectedContextId]: event.target.value,
                            }))
                          }
                        }}
                        placeholder='{&#10;  "example": "value"&#10;}'
                        className='min-h-[200px] font-mono text-[13px]'
                      />
                    </div>
                  </div>
                )}

                {/* Error/Success Messages */}
                {error && <p className='text-[12px] text-[var(--text-error)]'>{error}</p>}

                {message && (
                  <div className='rounded-[6px] border border-[var(--text-success)]/30 bg-[var(--text-success)]/10 p-[16px]'>
                    <p className='text-[13px] text-[var(--text-success)]'>{message}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className='flex justify-start'>
                  <Button
                    type='button'
                    onClick={handleResume}
                    disabled={resumeDisabled}
                    variant='tertiary'
                  >
                    {loadingAction ? 'Resuming...' : 'Resume Execution'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className='border-[var(--border)] border-t bg-[var(--surface-1)] py-[16px] text-center text-[13px] text-[var(--text-secondary)]'>
        Need help?{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='text-[var(--brand-primary)] underline-offset-4 transition hover:underline'
        >
          Contact support
        </a>
      </div>
    </div>
  )
}
