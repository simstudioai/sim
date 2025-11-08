'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { useBrandConfig } from '@/lib/branding/branding'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
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

const RESUME_STATUS_STYLES: Record<string, { style: string; icon: React.ReactNode }> = {
  paused: {
    style: 'border-amber-200 bg-amber-50 text-amber-700',
    icon: <Clock className='h-3 w-3' />,
  },
  queued: {
    style: 'border-blue-200 bg-blue-50 text-blue-700',
    icon: <Clock className='h-3 w-3' />,
  },
  resuming: {
    style: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    icon: <Play className='h-3 w-3' />,
  },
  resumed: {
    style: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: <CheckCircle2 className='h-3 w-3' />,
  },
  failed: {
    style: 'border-red-200 bg-red-50 text-red-700',
    icon: <XCircle className='h-3 w-3' />,
  },
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
  const config = RESUME_STATUS_STYLES[status] ?? {
    style: 'border-slate-200 bg-slate-100 text-slate-700',
    icon: <AlertCircle className='h-3 w-3' />,
  }
  return (
    <Badge variant='outline' className={`${config.style} flex items-center gap-1.5`}>
      {config.icon}
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
              <SelectTrigger className='w-full rounded-[12px] border-slate-200'>
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
              className='rounded-[12px] border-slate-200'
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
              className='min-h-[120px] rounded-[12px] border-slate-200 font-mono text-sm'
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
                className='min-h-[120px] rounded-[12px] border-slate-200'
              />
            )
          }
          return (
            <Input
              value={value}
              onChange={(event) => handleFormFieldChange(field.name, event.target.value)}
              placeholder={field.placeholder ?? 'Enter value...'}
              className='rounded-[12px] border-slate-200'
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
      <div className='flex flex-wrap items-center gap-2'>
        <ResumeStatusBadge status={selectedStatus} />
        {queuePosition && queuePosition > 0 ? (
          <span className={`${inter.className} text-slate-500 text-xs`}>
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
          className={`group w-full rounded-lg border p-3 text-left transition-all duration-150 hover:border-slate-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
            isSelected
              ? 'border-blue-500 bg-blue-50/50 shadow-sm'
              : subdued
                ? 'border-slate-200 bg-slate-50 opacity-75'
                : 'border-slate-200 bg-white'
          }`}
        >
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <p className='truncate font-medium text-slate-900 text-sm'>{pause.contextId}</p>
              </div>
              <div className='mt-1.5 flex items-center gap-1 text-slate-500 text-xs'>
                <Calendar className='h-3 w-3' />
                <span>{formatDate(pause.registeredAt)}</span>
              </div>
              {pause.queuePosition != null && pause.queuePosition > 0 && (
                <div className='mt-1 flex items-center gap-1 text-amber-600 text-xs'>
                  <Clock className='h-3 w-3' />
                  <span>Position {pause.queuePosition}</span>
                </div>
              )}
            </div>
            <div className='flex-shrink-0'>
              <ResumeStatusBadge status={pause.resumeStatus} />
            </div>
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
      <div className='min-h-screen bg-white'>
        <Nav variant='auth' />
        <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
          <div className='w-full max-w-[410px]'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1
                  className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
                >
                  Execution Not Found
                </h1>
                <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                  The execution you are trying to resume could not be located or has already
                  completed.
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
    <div className='min-h-screen bg-gradient-to-b from-slate-50 to-white'>
      <Nav variant='auth' />
      <div className='mx-auto min-h-[calc(100vh-120px)] max-w-7xl px-4 py-6 sm:py-8'>
        {/* Header Section */}
        <div className='mb-6'>
          <div className='flex items-center justify-between'>
            <div>
              <h1
                className={`${soehne.className} font-semibold text-3xl text-slate-900 tracking-tight`}
              >
                Paused Execution
              </h1>
              <p className={`${inter.className} mt-1 text-slate-600 text-sm`}>
                Review and manage execution pause points
              </p>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={refreshExecutionDetail}
              disabled={refreshingExecution}
              className='gap-2'
            >
              <RefreshCw className={`h-4 w-4 ${refreshingExecution ? 'animate-spin' : ''}`} />
              {refreshingExecution ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className='mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3'>
          <Card>
            <CardContent className='p-6'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='font-medium text-slate-600 text-sm'>Total Pauses</p>
                  <p className='mt-2 font-semibold text-3xl text-slate-900'>{totalPauses}</p>
                </div>
                <div className='rounded-full bg-blue-100 p-3'>
                  <Clock className='h-6 w-6 text-blue-600' />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='p-6'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='font-medium text-slate-600 text-sm'>Resumed</p>
                  <p className='mt-2 font-semibold text-3xl text-emerald-600'>{resumedCount}</p>
                </div>
                <div className='rounded-full bg-emerald-100 p-3'>
                  <CheckCircle2 className='h-6 w-6 text-emerald-600' />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='p-6'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='font-medium text-slate-600 text-sm'>Pending</p>
                  <p className='mt-2 font-semibold text-3xl text-amber-600'>{pendingCount}</p>
                </div>
                <div className='rounded-full bg-amber-100 p-3'>
                  <AlertCircle className='h-6 w-6 text-amber-600' />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
          {/* Left Column: Pause Points + History */}
          <div className='space-y-6 lg:col-span-1'>
            {/* Pause Points List */}
            <Card className='h-fit'>
              <CardHeader>
                <CardTitle className='text-lg'>Pause Points</CardTitle>
                <CardDescription>Select a pause point to view details</CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                {groupedPausePoints.active.length === 0 &&
                groupedPausePoints.resolved.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-8 text-center'>
                    <Clock className='mb-3 h-12 w-12 text-slate-300' />
                    <p className='text-slate-500 text-sm'>No pause points found</p>
                  </div>
                ) : (
                  <>
                    {groupedPausePoints.active.length > 0 && (
                      <div className='space-y-3'>
                        <h3 className='font-semibold text-slate-500 text-xs uppercase tracking-wider'>
                          Active
                        </h3>
                        <div className='space-y-2'>
                          {groupedPausePoints.active.map((pause) => renderPausePointCard(pause))}
                        </div>
                      </div>
                    )}

                    {groupedPausePoints.resolved.length > 0 && (
                      <>
                        {groupedPausePoints.active.length > 0 && <Separator className='my-4' />}
                        <div className='space-y-3'>
                          <h3 className='font-semibold text-slate-500 text-xs uppercase tracking-wider'>
                            Completed
                          </h3>
                          <div className='space-y-2'>
                            {groupedPausePoints.resolved.map((pause) =>
                              renderPausePointCard(pause, true)
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* History */}
            {selectedDetail && (
              <Card>
                <CardHeader>
                  <CardTitle className='text-lg'>Resume History</CardTitle>
                  <CardDescription>Previous resume attempts for this pause</CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedDetail.queue.length > 0 ? (
                    <div className='space-y-3'>
                      {selectedDetail.queue.map((entry) => {
                        const normalizedStatus = entry.status?.toLowerCase?.() ?? entry.status
                        return (
                          <div key={entry.id} className='rounded-lg border bg-white p-3'>
                            <div className='flex items-start justify-between gap-2'>
                              <div className='space-y-2'>
                                <ResumeStatusBadge status={normalizedStatus} />
                                <div className='space-y-1 text-slate-600 text-xs'>
                                  <p>
                                    ID:{' '}
                                    <span className='font-medium text-slate-900'>
                                      {entry.newExecutionId}
                                    </span>
                                  </p>
                                  {entry.claimedAt && <p>Started: {formatDate(entry.claimedAt)}</p>}
                                  {entry.completedAt && (
                                    <p>Completed: {formatDate(entry.completedAt)}</p>
                                  )}
                                </div>
                                {entry.failureReason && (
                                  <div className='mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-700 text-xs'>
                                    {entry.failureReason}
                                  </div>
                                )}
                              </div>
                              <span className='text-slate-400 text-xs'>
                                {formatDate(entry.queuedAt)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className='flex flex-col items-center justify-center py-8 text-center'>
                      <Clock className='mb-3 h-8 w-8 text-slate-300' />
                      <p className='text-slate-500 text-sm'>No resume attempts yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column: Content + Input */}
          <div className='space-y-6 lg:col-span-2'>
            {loadingDetail && !selectedDetail ? (
              <Card>
                <CardContent className='flex h-64 items-center justify-center p-6'>
                  <div className='text-center'>
                    <RefreshCw className='mx-auto mb-3 h-8 w-8 animate-spin text-slate-400' />
                    <p className='text-slate-500 text-sm'>Loading pause details...</p>
                  </div>
                </CardContent>
              </Card>
            ) : !selectedContextId ? (
              <Card>
                <CardContent className='flex h-64 items-center justify-center p-6'>
                  <div className='text-center'>
                    <FileText className='mx-auto mb-3 h-12 w-12 text-slate-300' />
                    <p className='text-slate-500 text-sm'>Select a pause point to view details</p>
                  </div>
                </CardContent>
              </Card>
            ) : !selectedDetail ? (
              <Card>
                <CardContent className='flex h-64 items-center justify-center p-6'>
                  <div className='text-center'>
                    <XCircle className='mx-auto mb-3 h-12 w-12 text-red-300' />
                    <p className='text-slate-500 text-sm'>Pause details could not be loaded</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Header with Status */}
                <div className='flex items-center justify-between'>
                  <div>
                    <h2 className='font-semibold text-2xl text-slate-900'>Pause Details</h2>
                    <p className='mt-1 text-slate-600 text-sm'>
                      Review content and provide input to resume
                    </p>
                  </div>
                  {statusDetailNode}
                </div>

                {/* Active Resume Entry Alert */}
                {selectedDetail.activeResumeEntry && (
                  <Card className='border-blue-200 bg-blue-50/50'>
                    <CardHeader>
                      <div className='flex items-center justify-between'>
                        <CardTitle className='text-blue-900 text-sm'>
                          Current Resume Attempt
                        </CardTitle>
                        <ResumeStatusBadge
                          status={
                            selectedDetail.activeResumeEntry.status?.toLowerCase?.() ??
                            selectedDetail.activeResumeEntry.status
                          }
                        />
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-2 text-blue-800 text-sm'>
                      <p>
                        Resume execution ID:{' '}
                        <span className='font-medium'>
                          {selectedDetail.activeResumeEntry.newExecutionId}
                        </span>
                      </p>
                      {selectedDetail.activeResumeEntry.claimedAt && (
                        <p>Started at {formatDate(selectedDetail.activeResumeEntry.claimedAt)}</p>
                      )}
                      {selectedDetail.activeResumeEntry.completedAt && (
                        <p>
                          Completed at {formatDate(selectedDetail.activeResumeEntry.completedAt)}
                        </p>
                      )}
                      {selectedDetail.activeResumeEntry.failureReason && (
                        <div className='mt-2 rounded border border-red-300 bg-red-100 p-3 text-red-800 text-sm'>
                          {selectedDetail.activeResumeEntry.failureReason}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Content Section */}
                {responseStructureRows.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-sm'>Content</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className='overflow-hidden rounded-lg border'>
                        <table className='min-w-full divide-y divide-slate-200'>
                          <thead className='bg-slate-50'>
                            <tr>
                              <th className='px-4 py-2 text-left font-medium text-slate-600 text-xs'>
                                Field
                              </th>
                              <th className='px-4 py-2 text-left font-medium text-slate-600 text-xs'>
                                Type
                              </th>
                              <th className='px-4 py-2 text-left font-medium text-slate-600 text-xs'>
                                Value
                              </th>
                            </tr>
                          </thead>
                          <tbody className='divide-y divide-slate-200 bg-white'>
                            {responseStructureRows.map((row) => (
                              <tr key={row.id}>
                                <td className='px-4 py-2 font-medium text-slate-800 text-sm'>
                                  {row.name}
                                </td>
                                <td className='px-4 py-2 text-slate-500 text-sm'>{row.type}</td>
                                <td className='px-4 py-2'>
                                  <pre className='max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-slate-700 text-xs'>
                                    {formatStructureValue(row.value)}
                                  </pre>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-sm'>Pause Response Data</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className='max-h-60 overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-slate-100 text-xs'>
                        {pauseResponsePreview}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {/* Input Section */}
                {isHumanMode && hasInputFormat ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-sm'>Resume Form</CardTitle>
                      <CardDescription>
                        Fill out the required fields to resume execution
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='space-y-4'>
                      {inputFormatFields.map((field) => (
                        <div key={field.id} className='space-y-2'>
                          <Label className='font-medium text-slate-700 text-sm'>
                            {field.label}
                            {field.required && <span className='ml-1 text-red-500'>*</span>}
                          </Label>
                          {field.description && (
                            <p className='text-slate-500 text-xs'>{field.description}</p>
                          )}
                          {renderFieldInput(field)}
                          {formErrors[field.name] && (
                            <p className='text-red-600 text-xs'>{formErrors[field.name]}</p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-sm'>Resume Input (JSON)</CardTitle>
                      <CardDescription>
                        Provide optional JSON input to pass to the resumed execution
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
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
                        className='min-h-[200px] font-mono text-sm'
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Error/Success Messages */}
                {error && (
                  <Card className='border-red-200 bg-red-50'>
                    <CardContent className='flex items-start gap-3 p-4'>
                      <XCircle className='mt-0.5 h-5 w-5 flex-shrink-0 text-red-600' />
                      <div className='text-red-700 text-sm'>{error}</div>
                    </CardContent>
                  </Card>
                )}

                {message && (
                  <Card className='border-emerald-200 bg-emerald-50'>
                    <CardContent className='flex items-start gap-3 p-4'>
                      <CheckCircle2 className='mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600' />
                      <div className='text-emerald-700 text-sm'>{message}</div>
                    </CardContent>
                  </Card>
                )}

                {/* Action Buttons */}
                <div className='flex justify-start'>
                  <Button
                    type='button'
                    onClick={handleResume}
                    disabled={resumeDisabled}
                    className='gap-2'
                    size='lg'
                  >
                    <Play className='h-4 w-4' />
                    {loadingAction ? 'Resuming...' : 'Resume Execution'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className='border-t bg-white py-4 text-center text-slate-600 text-sm'>
        Need help?{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='text-blue-600 underline-offset-4 transition hover:underline'
        >
          Contact support
        </a>
      </div>
    </div>
  )
}
