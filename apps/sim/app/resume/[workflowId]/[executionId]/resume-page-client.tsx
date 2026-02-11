'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Nav from '@/app/(landing)/components/nav/nav'
import { useBrandConfig } from '@/ee/whitelabeling'
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
  triggerBlockId?: string
  blockId?: string
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

const STATUS_BADGE_VARIANT: Record<string, 'orange' | 'blue' | 'green' | 'red' | 'gray'> = {
  paused: 'orange',
  queued: 'blue',
  resuming: 'blue',
  resumed: 'green',
  failed: 'red',
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

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status] ?? 'gray'} size='sm'>
      {getStatusLabel(status)}
    </Badge>
  )
}

function getBlockNameFromSnapshot(
  executionSnapshot: { snapshot?: string } | null | undefined,
  blockId: string | undefined
): string | null {
  if (!executionSnapshot?.snapshot || !blockId) return null
  try {
    const parsed = JSON.parse(executionSnapshot.snapshot)
    const workflowState = parsed?.workflow
    if (!workflowState?.blocks || !Array.isArray(workflowState.blocks)) return null
    // Blocks are stored as an array of serialized blocks with id and metadata.name
    const block = workflowState.blocks.find((b: { id: string }) => b.id === blockId)
    return block?.metadata?.name || null
  } catch {
    return null
  }
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
  const pausePoints = executionDetail?.pausePoints ?? []

  const defaultContextId = useMemo(() => {
    if (initialContextId) return initialContextId
    return (
      pausePoints.find((point) => point.resumeStatus === 'paused')?.contextId ??
      pausePoints[0]?.contextId
    )
  }, [initialContextId, pausePoints])

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
        return {
          id: typeof field.id === 'string' && field.id.length > 0 ? field.id : `field_${index}`,
          name,
          label:
            typeof field.label === 'string' && field.label.trim().length > 0
              ? field.label.trim()
              : name,
          type:
            typeof field.type === 'string' && field.type.trim().length > 0 ? field.type : 'string',
          description:
            typeof field.description === 'string' && field.description.trim().length > 0
              ? field.description.trim()
              : undefined,
          placeholder:
            typeof field.placeholder === 'string' && field.placeholder.trim().length > 0
              ? field.placeholder.trim()
              : undefined,
          value: field.value,
          required: field.required === true,
          options: Array.isArray(field.options) ? field.options : undefined,
          rows: typeof field.rows === 'number' ? field.rows : undefined,
        } as NormalizedInputField
      })
      .filter((field): field is NormalizedInputField => field !== null)
  }, [])

  const formatValueForInputField = useCallback(
    (field: NormalizedInputField, value: any): string => {
      if (value === undefined || value === null) return ''
      switch (field.type) {
        case 'boolean':
          if (typeof value === 'boolean') return value ? 'true' : 'false'
          if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase()
            if (normalized === 'true' || normalized === 'false') return normalized
          }
          return ''
        case 'number':
          if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
          if (typeof value === 'string') return value
          return ''
        case 'array':
        case 'object':
        case 'files':
          if (typeof value === 'string') return value
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
          if (!value.trim()) return { value: null }
          const numericValue = Number(value)
          if (Number.isNaN(numericValue)) return { value: null, error: 'Enter a valid number.' }
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
        if (!prev[fieldName]) return prev
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
              <SelectTrigger>
                <SelectValue placeholder={field.required ? 'Select true or false' : 'Select...'} />
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
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? 'Enter a number...'}
            />
          )
        case 'array':
        case 'object':
        case 'files':
          return (
            <Textarea
              value={value}
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? (field.type === 'array' ? '[...]' : '{...}')}
              rows={5}
            />
          )
        default: {
          if (field.rows !== undefined && field.rows > 3) {
            return (
              <Textarea
                value={value}
                onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
                placeholder={field.placeholder ?? 'Enter value...'}
                rows={5}
              />
            )
          }
          return (
            <Input
              value={value}
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? 'Enter value...'}
            />
          )
        }
      }
    },
    [formValues, handleFormFieldChange]
  )

  const renderDisabledFieldInput = useCallback(
    (field: NormalizedInputField, resumedValues: Record<string, any>) => {
      const rawValue = resumedValues[field.name]
      const value =
        rawValue !== undefined
          ? typeof rawValue === 'object'
            ? JSON.stringify(rawValue)
            : String(rawValue)
          : ''
      switch (field.type) {
        case 'boolean': {
          const displayValue = rawValue === true ? 'True' : rawValue === false ? 'False' : 'Not set'
          return <Input value={displayValue} disabled />
        }
        case 'number':
          return <Input type='number' value={value} disabled />
        case 'array':
        case 'object':
        case 'files':
          return <Textarea value={value} disabled rows={5} />
        default: {
          if (field.rows !== undefined && field.rows > 3) {
            return <Textarea value={value} disabled rows={5} />
          }
          return <Input value={value} disabled />
        }
      }
    },
    []
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
            if (existingValues) mergedValues = { ...baseValues, ...existingValues }
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
      if (!response.ok) return
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
        if (showLoader) setLoadingDetail(true)
        const response = await fetch(`/api/resume/${workflowId}/${executionId}/${contextId}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        })
        if (!response.ok) return
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
            if (existingValues) mergedValues = { ...baseValues, ...existingValues }
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
        if (showLoader) setLoadingDetail(false)
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
          if (field.required) errors[field.name] = 'This field is required.'
          continue
        }
        const { value, error: parseError } = parseFormValue(field, rawValue)
        if (parseError) {
          errors[field.name] = parseError
          continue
        }
        if (value !== undefined) submission[field.name] = value
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
        } catch {
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
          headers: { 'Content-Type': 'application/json' },
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
        if (!prev) return prev
        return {
          ...prev,
          pausePoints: prev.pausePoints.map((point) =>
            point.contextId === selectedContextId
              ? { ...point, resumeStatus: nextStatus, queuePosition: nextQueuePosition }
              : point
          ),
        }
      })
      setSelectedDetail((prev) => {
        if (!prev || prev.pausePoint.contextId !== selectedContextId) return prev
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
      setSelectedContextId((prev) => (prev !== selectedContextId ? prev : fallbackContextId))
      setMessage(
        payload.status === 'queued' ? 'Resume request queued.' : 'Resume started successfully.'
      )
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

  const isFormComplete = useMemo(() => {
    if (!isHumanMode || !hasInputFormat) return true
    return inputFormatFields.every((field) => {
      const rawValue = formValues[field.name] ?? ''
      if (field.type === 'boolean') {
        if (field.required) return rawValue === 'true' || rawValue === 'false'
        return rawValue === '' || rawValue === 'true' || rawValue === 'false'
      }
      if (!field.required) return true
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

  const getBlockName = (pause: PausePointWithQueue) => {
    const pauseBlockId = pause.blockId || pause.triggerBlockId
    return (
      getBlockNameFromSnapshot(executionDetail?.executionSnapshot, pauseBlockId) ||
      'Human in the Loop'
    )
  }

  // Not found state
  if (!executionDetail) {
    return (
      <Tooltip.Provider>
        <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
          <Nav variant='auth' />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 'calc(100vh - 80px)',
              padding: '24px',
            }}
          >
            <div style={{ textAlign: 'center', maxWidth: '400px' }}>
              <h1
                style={{
                  fontSize: '20px',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  marginBottom: '8px',
                }}
              >
                Execution Not Found
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
                This execution could not be located or has already completed.
              </p>
              <Button variant='outline' onClick={() => router.push('/')}>
                Return Home
              </Button>
            </div>
          </div>
        </div>
      </Tooltip.Provider>
    )
  }

  return (
    <Tooltip.Provider>
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <Nav variant='auth' />
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '32px',
            }}
          >
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)' }}>
                Paused Execution
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Select a pause point to review and resume
              </p>
            </div>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='outline'
                  onClick={refreshExecutionDetail}
                  disabled={refreshingExecution}
                >
                  <RefreshCw
                    style={{
                      width: '14px',
                      height: '14px',
                      animation: refreshingExecution ? 'spin 1s linear infinite' : undefined,
                    }}
                  />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh</Tooltip.Content>
            </Tooltip.Root>
          </div>

          {/* Main Layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px' }}>
            {/* Pause Points List */}
            <div
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <Label>Pause Points</Label>
              </div>
              <div>
                {pausePoints.length === 0 ? (
                  <div
                    style={{
                      padding: '32px 16px',
                      textAlign: 'center',
                      color: 'var(--text-secondary)',
                      fontSize: '13px',
                    }}
                  >
                    No pause points
                  </div>
                ) : (
                  pausePoints.map((pause) => (
                    <Button
                      key={pause.contextId}
                      variant={pause.contextId === selectedContextId ? 'active' : 'ghost'}
                      onClick={() => {
                        setSelectedContextId(pause.contextId)
                        setError(null)
                        setMessage(null)
                      }}
                      style={{
                        width: '100%',
                        justifyContent: 'space-between',
                        borderRadius: 0,
                        padding: '12px 16px',
                      }}
                    >
                      <span style={{ fontSize: '13px' }}>{getBlockName(pause)}</span>
                      <StatusBadge status={pause.resumeStatus} />
                    </Button>
                  ))
                )}
              </div>
            </div>

            {/* Detail Panel */}
            <div>
              {loadingDetail && !selectedDetail ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '200px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Loading...
                  </span>
                </div>
              ) : !selectedContextId ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '200px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Select a pause point
                  </span>
                </div>
              ) : !selectedDetail ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '200px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Could not load details
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Status Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '12px 16px',
                    }}
                  >
                    <div>
                      <Label>{getBlockName(selectedDetail.pausePoint)}</Label>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Paused at {formatDate(selectedDetail.pausePoint.registeredAt)}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <StatusBadge status={selectedStatus} />
                      {queuePosition && queuePosition > 0 && (
                        <Badge variant='gray' size='sm'>
                          Queue #{queuePosition}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Already resolved - show form fields with submitted values */}
                  {selectedStatus === 'resumed' || selectedStatus === 'failed' ? (
                    <div
                      style={{
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}
                      >
                        <Label>Resume Form</Label>
                      </div>
                      <div
                        style={{
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px',
                        }}
                      >
                        {selectedStatus === 'failed' &&
                          selectedDetail.pausePoint.latestResumeEntry?.failureReason && (
                            <Badge variant='red' size='sm'>
                              {selectedDetail.pausePoint.latestResumeEntry.failureReason}
                            </Badge>
                          )}
                        {inputFormatFields.length > 0 &&
                        selectedDetail.pausePoint.latestResumeEntry?.resumeInput ? (
                          inputFormatFields.map((field) => (
                            <div
                              key={field.id}
                              style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                            >
                              <Label>{field.label}</Label>
                              {field.description && (
                                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                  {field.description}
                                </p>
                              )}
                              {renderDisabledFieldInput(
                                field,
                                selectedDetail.pausePoint.latestResumeEntry?.resumeInput
                                  ?.submission ??
                                  selectedDetail.pausePoint.latestResumeEntry?.resumeInput ??
                                  {}
                              )}
                            </div>
                          ))
                        ) : selectedDetail.pausePoint.latestResumeEntry?.resumeInput ? (
                          <Textarea
                            value={JSON.stringify(
                              selectedDetail.pausePoint.latestResumeEntry.resumeInput,
                              null,
                              2
                            )}
                            disabled
                            rows={6}
                          />
                        ) : (
                          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            No input data provided
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Display Data */}
                      {responseStructureRows.length > 0 ? (
                        <div
                          style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 16px',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <Label>Display Data</Label>
                          </div>
                          <div style={{ padding: '16px' }}>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Field</TableHead>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Value</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {responseStructureRows.map((row) => (
                                  <TableRow key={row.id}>
                                    <TableCell>{row.name}</TableCell>
                                    <TableCell>{row.type}</TableCell>
                                    <TableCell>
                                      <code style={{ fontSize: '12px' }}>
                                        {formatStructureValue(row.value)}
                                      </code>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 16px',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <Label>Display Data</Label>
                          </div>
                          <div style={{ padding: '16px' }}>
                            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                              No display data configured
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Resume Form */}
                      {isHumanMode && hasInputFormat ? (
                        <div
                          style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 16px',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <Label>Resume Form</Label>
                          </div>
                          <div
                            style={{
                              padding: '16px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '16px',
                            }}
                          >
                            {inputFormatFields.map((field) => (
                              <div
                                key={field.id}
                                style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                              >
                                <Label>
                                  {field.label}
                                  {field.required && (
                                    <span style={{ color: 'var(--text-error)', marginLeft: '4px' }}>
                                      *
                                    </span>
                                  )}
                                </Label>
                                {field.description && (
                                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    {field.description}
                                  </p>
                                )}
                                {renderFieldInput(field)}
                                {formErrors[field.name] && (
                                  <Badge variant='red' size='sm'>
                                    {formErrors[field.name]}
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 16px',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <Label>Resume Input (JSON)</Label>
                          </div>
                          <div style={{ padding: '16px' }}>
                            <Textarea
                              value={resumeInput}
                              onChange={(e) => {
                                setResumeInput(e.target.value)
                                if (selectedContextId)
                                  setResumeInputs((prev) => ({
                                    ...prev,
                                    [selectedContextId]: e.target.value,
                                  }))
                              }}
                              placeholder='{"example": "value"}'
                              rows={6}
                            />
                          </div>
                        </div>
                      )}

                      {/* Messages */}
                      {error && <Badge variant='red'>{error}</Badge>}
                      {message && <Badge variant='green'>{message}</Badge>}

                      {/* Action */}
                      <Button variant='tertiary' onClick={handleResume} disabled={resumeDisabled}>
                        {loadingAction ? 'Resuming...' : 'Resume Execution'}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: '32px',
            padding: '16px',
            textAlign: 'center',
            borderTop: '1px solid var(--border)',
            fontSize: '13px',
            color: 'var(--text-muted)',
          }}
        >
          Need help?{' '}
          <a href={`mailto:${brandConfig.supportEmail}`} style={{ color: 'var(--text-secondary)' }}>
            Contact support
          </a>
        </div>
      </div>
    </Tooltip.Provider>
  )
}
