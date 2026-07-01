'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  ChipInput,
  ChipSelect,
  ChipTextarea,
  Code,
  cn,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  type PauseContextDetail,
  type PausedExecutionDetail,
  type PausePointWithQueue,
  resumeKeys,
  usePauseContextDetail,
  useResumeContext,
  useResumeExecutionDetail,
} from '@/hooks/queries/resume-execution'

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
    const block = workflowState.blocks.find((b: { id: string }) => b.id === blockId)
    return block?.metadata?.name || null
  } catch {
    return null
  }
}

function renderStructuredValuePreview(value: unknown) {
  if (value === null || value === undefined) {
    return <span className='text-[12px] text-[var(--text-muted)]'>—</span>
  }

  if (typeof value === 'object') {
    return (
      <div className='min-w-[220px]'>
        <Code.Viewer
          code={JSON.stringify(value, null, 2)}
          language='json'
          wrapText
          className='max-h-[220px]'
        />
      </div>
    )
  }

  const stringValue = String(value)
  return (
    <div className='inline-flex max-w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface-5)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)] leading-4 [white-space:pre-wrap] [word-break:break-word]'>
      {stringValue}
    </div>
  )
}

export default function ResumeExecutionPage({
  params,
  initialExecutionDetail,
  initialContextId,
}: ResumeExecutionPageProps) {
  const { workflowId, executionId } = params
  const router = useRouter()
  const queryClient = useQueryClient()

  const {
    data: executionDetail,
    isFetching: refreshingExecution,
    refetch: refetchExecutionDetail,
  } = useResumeExecutionDetail(workflowId, executionId, initialExecutionDetail ?? undefined)
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
  const { data: selectedDetail, isLoading: loadingDetail } = usePauseContextDetail(
    workflowId,
    executionId,
    selectedContextId ?? undefined
  )
  const [selectedStatus, setSelectedStatus] =
    useState<PausePointWithQueue['resumeStatus']>('paused')
  const [queuePosition, setQueuePosition] = useState<number | null | undefined>(undefined)
  const resumeInputsRef = useRef<Record<string, string>>({})
  const [resumeInput, setResumeInput] = useState('')
  const [formValuesByContext, setFormValuesByContext] = useState<
    Record<string, Record<string, string>>
  >({})
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [loadingAction, setLoadingAction] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const resumeMutation = useResumeContext()

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
            <ChipSelect
              value={selectValue}
              onChange={(val) => handleFormFieldChange(field.name, val)}
              placeholder={field.required ? 'Select true or false' : 'Select...'}
              options={[
                ...(field.required ? [] : [{ label: 'Not set', value: '__unset__' }]),
                { label: 'True', value: 'true' },
                { label: 'False', value: 'false' },
              ]}
            />
          )
        }
        case 'number':
          return (
            <ChipInput
              type='number'
              value={value}
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? 'Enter a number...'}
              error={Boolean(formErrors[field.name])}
            />
          )
        case 'array':
        case 'object':
        case 'files':
          return (
            <ChipTextarea
              value={value}
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? (field.type === 'array' ? '[...]' : '{...}')}
              rows={5}
              error={Boolean(formErrors[field.name])}
            />
          )
        default: {
          if (field.rows !== undefined && field.rows > 3) {
            return (
              <ChipTextarea
                value={value}
                onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
                placeholder={field.placeholder ?? 'Enter value...'}
                rows={5}
                error={Boolean(formErrors[field.name])}
              />
            )
          }
          return (
            <ChipInput
              value={value}
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? 'Enter value...'}
              error={Boolean(formErrors[field.name])}
            />
          )
        }
      }
    },
    [formValues, formErrors, handleFormFieldChange]
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
          return <ChipInput value={displayValue} disabled />
        }
        case 'number':
          return <ChipInput type='number' value={value} disabled />
        case 'array':
        case 'object':
        case 'files':
          return <ChipTextarea value={value} viewOnly rows={5} />
        default: {
          if (field.rows !== undefined && field.rows > 3) {
            return <ChipTextarea value={value} viewOnly rows={5} />
          }
          return <ChipInput value={value} disabled />
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

  const seedFormFromDetail = useCallback(
    (detail: PauseContextDetail) => {
      const responseData = detail.pausePoint.response?.data ?? {}
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
          const existingValues = prev[detail.pausePoint.contextId]
          if (existingValues) mergedValues = { ...baseValues, ...existingValues }
          return { ...prev, [detail.pausePoint.contextId]: mergedValues }
        })
        setFormValues(mergedValues)
        setFormErrors({})
        if (resumeInputsRef.current[detail.pausePoint.contextId] !== undefined) {
          delete resumeInputsRef.current[detail.pausePoint.contextId]
        }
        setResumeInput('')
      } else {
        const initialValue =
          typeof responseData === 'string'
            ? responseData
            : JSON.stringify(responseData ?? {}, null, 2)
        if (resumeInputsRef.current[detail.pausePoint.contextId] !== undefined) {
          setResumeInput(resumeInputsRef.current[detail.pausePoint.contextId])
        } else {
          setResumeInput(initialValue)
          resumeInputsRef.current = {
            ...resumeInputsRef.current,
            [detail.pausePoint.contextId]: initialValue,
          }
        }
        setFormValues({})
        setFormErrors({})
      }
    },
    [normalizeInputFormatFields, buildInitialFormValues]
  )

  useEffect(() => {
    if (!selectedDetail) return
    setSelectedStatus(selectedDetail.pausePoint.resumeStatus)
    setQueuePosition(selectedDetail.pausePoint.queuePosition)
    seedFormFromDetail(selectedDetail)
  }, [selectedDetail, seedFormFromDetail])

  const handleRefreshExecution = useCallback(async () => {
    const { data } = await refetchExecutionDetail()
    if (!selectedContextId) {
      const firstPaused =
        data?.pausePoints.find((point) => point.resumeStatus === 'paused')?.contextId ?? null
      setSelectedContextId(firstPaused)
    }
  }, [refetchExecutionDetail, selectedContextId])

  const handleResume = useCallback(
    async () => {
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
        const { ok, payload } = await resumeMutation.mutateAsync({
          workflowId,
          executionId,
          contextId: selectedContextId,
          input: resumePayload,
        })
        if (!ok) {
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
        queryClient.setQueryData<PausedExecutionDetail>(
          resumeKeys.execution(workflowId, executionId),
          (prev) => {
            if (!prev) return prev
            return {
              ...prev,
              pausePoints: prev.pausePoints.map((point) =>
                point.contextId === selectedContextId
                  ? { ...point, resumeStatus: nextStatus, queuePosition: nextQueuePosition }
                  : point
              ),
            }
          }
        )
        queryClient.setQueryData<PauseContextDetail | null>(
          resumeKeys.context(workflowId, executionId, selectedContextId),
          (prev) => {
            if (!prev || prev.pausePoint.contextId !== selectedContextId) return prev
            return {
              ...prev,
              pausePoint: {
                ...prev.pausePoint,
                resumeStatus: nextStatus,
                queuePosition: nextQueuePosition,
              },
            }
          }
        )
        setSelectedStatus(nextStatus)
        setQueuePosition(nextQueuePosition)
        setSelectedContextId((prev) => (prev !== selectedContextId ? prev : fallbackContextId))
        setMessage(
          payload.status === 'queued' ? 'Resume request queued.' : 'Resume started successfully.'
        )
      } catch (err: any) {
        setError(err.message || 'Unexpected error while resuming execution.')
      } finally {
        setLoadingAction(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
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
      queryClient,
    ]
  )

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
        <div className='flex flex-1 items-center justify-center p-6'>
          <div className='max-w-[400px] text-center'>
            <h1 className='mb-2 font-medium text-[20px] text-[var(--text-primary)]'>
              Execution Not Found
            </h1>
            <p className='mb-6 text-[14px] text-[var(--text-secondary)]'>
              This execution could not be located or has already completed.
            </p>
            <Button variant='outline' onClick={() => router.push('/')}>
              Return Home
            </Button>
          </div>
        </div>
      </Tooltip.Provider>
    )
  }

  return (
    <Tooltip.Provider>
      <div className='mx-auto w-full max-w-[1200px] px-6 py-8'>
        {/* Header */}
        <div className='mb-8 flex items-center justify-between'>
          <div>
            <h1 className='font-medium text-[20px] text-[var(--text-primary)]'>Paused Execution</h1>
            <p className='mt-1 text-[14px] text-[var(--text-secondary)]'>
              Select a pause point to review and resume
            </p>
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='outline'
                size='sm'
                onClick={handleRefreshExecution}
                disabled={refreshingExecution}
                className='gap-1.5 px-2.5'
                aria-label='Refresh execution details'
              >
                <RefreshCw className={cn('size-[14px]', refreshingExecution && 'animate-spin')} />
                Refresh
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Refresh</Tooltip.Content>
          </Tooltip.Root>
        </div>

        {/* Main Layout */}
        <div className='grid grid-cols-[280px_1fr] gap-6'>
          {/* Pause Points List */}
          <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
            <div className='border-[var(--border)] border-b px-4 py-3'>
              <Label>Pause Points</Label>
            </div>
            <div>
              {pausePoints.length === 0 ? (
                <div className='px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]'>
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
                    className='w-full justify-between rounded-none px-4 py-3'
                  >
                    <span className='text-[13px]'>{getBlockName(pause)}</span>
                    <StatusBadge status={pause.resumeStatus} />
                  </Button>
                ))
              )}
            </div>
          </div>

          {/* Detail Panel */}
          <div>
            {loadingDetail && !selectedDetail ? (
              <div className='flex h-[200px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <span className='text-[13px] text-[var(--text-secondary)]'>Loading…</span>
              </div>
            ) : !selectedContextId ? (
              <div className='flex h-[200px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <span className='text-[13px] text-[var(--text-secondary)]'>
                  Select a pause point
                </span>
              </div>
            ) : !selectedDetail ? (
              <div className='flex h-[200px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                <span className='text-[13px] text-[var(--text-secondary)]'>
                  Could not load details
                </span>
              </div>
            ) : (
              <div className='flex flex-col gap-4'>
                {/* Status Header */}
                <div className='flex items-center justify-between rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3'>
                  <div>
                    <Label>{getBlockName(selectedDetail.pausePoint)}</Label>
                    <p className='mt-[2px] text-[12px] text-[var(--text-muted)]'>
                      Paused at {formatDate(selectedDetail.pausePoint.registeredAt)}
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
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
                  <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                    <div className='border-[var(--border)] border-b px-4 py-3'>
                      <Label>Resume Form</Label>
                    </div>
                    <div className='flex flex-col gap-4 p-4'>
                      {selectedStatus === 'failed' &&
                        selectedDetail.pausePoint.latestResumeEntry?.failureReason && (
                          <Badge variant='red' size='sm'>
                            {selectedDetail.pausePoint.latestResumeEntry.failureReason}
                          </Badge>
                        )}
                      {inputFormatFields.length > 0 &&
                      selectedDetail.pausePoint.latestResumeEntry?.resumeInput ? (
                        inputFormatFields.map((field) => (
                          <div key={field.id} className='flex flex-col gap-[9px]'>
                            <Label>{field.label}</Label>
                            {field.description && (
                              <p className='text-[12px] text-[var(--text-muted)]'>
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
                        <ChipTextarea
                          value={JSON.stringify(
                            selectedDetail.pausePoint.latestResumeEntry.resumeInput,
                            null,
                            2
                          )}
                          viewOnly
                          rows={6}
                        />
                      ) : (
                        <p className='text-[13px] text-[var(--text-muted)]'>
                          No input data provided
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Display Data */}
                    {responseStructureRows.length > 0 ? (
                      <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                        <div className='border-[var(--border)] border-b px-4 py-3'>
                          <Label>Display Data</Label>
                        </div>
                        <div className='p-4'>
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
                                  <TableCell>{renderStructuredValuePreview(row.value)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ) : (
                      <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                        <div className='border-[var(--border)] border-b px-4 py-3'>
                          <Label>Display Data</Label>
                        </div>
                        <div className='p-4'>
                          <p className='text-[13px] text-[var(--text-muted)]'>
                            No display data configured
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Resume Form */}
                    {isHumanMode && hasInputFormat ? (
                      <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                        <div className='border-[var(--border)] border-b px-4 py-3'>
                          <Label>Resume Form</Label>
                        </div>
                        <div className='flex flex-col gap-4 p-4'>
                          {inputFormatFields.map((field) => (
                            <div key={field.id} className='flex flex-col gap-[9px]'>
                              <Label>
                                {field.label}
                                {field.required && (
                                  <span className='ml-1 text-[var(--text-error)]'>*</span>
                                )}
                              </Label>
                              {field.description && (
                                <p className='text-[12px] text-[var(--text-muted)]'>
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
                      <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
                        <div className='border-[var(--border)] border-b px-4 py-3'>
                          <Label>Resume Input (JSON)</Label>
                        </div>
                        <div className='p-4'>
                          <ChipTextarea
                            value={resumeInput}
                            onChange={(e) => {
                              setResumeInput(e.target.value)
                              if (selectedContextId) {
                                resumeInputsRef.current = {
                                  ...resumeInputsRef.current,
                                  [selectedContextId]: e.target.value,
                                }
                              }
                            }}
                            placeholder='{"example": "value"}'
                            rows={6}
                            spellCheck={false}
                            className='min-h-[180px] font-mono'
                          />
                        </div>
                      </div>
                    )}

                    {/* Messages */}
                    {error && <Badge variant='red'>{error}</Badge>}
                    {message && <Badge variant='green'>{message}</Badge>}

                    {/* Action */}
                    <Button variant='primary' onClick={handleResume} disabled={resumeDisabled}>
                      {loadingAction ? 'Resuming...' : 'Resume Execution'}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  )
}
