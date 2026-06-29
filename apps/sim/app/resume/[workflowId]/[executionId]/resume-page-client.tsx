'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Badge,
  Button,
  Code,
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
import Navbar from '@/app/(landing)/components/navbar/navbar'
import { useBrandConfig } from '@/ee/whitelabeling'
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
    return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</span>
  }

  if (typeof value === 'object') {
    return (
      <div style={{ minWidth: '220px' }}>
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const { workflowId, executionId } = params
  const router = useRouter()
  const brandConfig = useBrandConfig()
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
            <Select
              value={selectValue}
              onValueChange={(val) => handleFormFieldChange(field.name, val)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={field.required ? tI18n('select_true_or_false') : 'Select...'}
                />
              </SelectTrigger>
              <SelectContent>
                {!field.required && <SelectItem value='__unset__'>{t('not_set')}</SelectItem>}
                <SelectItem value='true'>{t('true')}</SelectItem>
                <SelectItem value='false'>{t('false')}</SelectItem>
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
              placeholder={field.placeholder ?? tI18n('enter_a_number')}
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
                placeholder={field.placeholder ?? tI18n('enter_value')}
                rows={5}
              />
            )
          }
          return (
            <Input
              value={value}
              onChange={(e) => handleFormFieldChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? tI18n('enter_value')}
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
        <div className='font-season' style={{ minHeight: '100vh', background: 'var(--bg)' }}>
          <header>
            <Navbar />
          </header>
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
                {t('execution_not_found')}
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
                {t('this_execution_could_not_be_located')}
              </p>
              <Button variant='outline' onClick={() => router.push('/')}>
                {t('return_home')}
              </Button>
            </div>
          </div>
        </div>
      </Tooltip.Provider>
    )
  }

  return (
    <Tooltip.Provider>
      <div className='font-season' style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <header>
          <Navbar />
        </header>
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
                {t('paused_execution')}
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {t('select_a_pause_point_to_review')}
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
                  aria-label={t('refresh_execution_details')}
                >
                  <RefreshCw
                    style={{
                      width: '14px',
                      height: '14px',
                      animation: refreshingExecution ? 'spin 1s linear infinite' : undefined,
                    }}
                  />
                  {t('refresh')}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{t('refresh')}</Tooltip.Content>
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
                <Label>{t('pause_points')}</Label>
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
                    {t('no_pause_points')}
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
                    {t('loading')}
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
                    {t('select_a_pause_point')}
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
                    {t('could_not_load_details')}
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
                        {t('paused_at')} {formatDate(selectedDetail.pausePoint.registeredAt)}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <StatusBadge status={selectedStatus} />
                      {queuePosition && queuePosition > 0 && (
                        <Badge variant='gray' size='sm'>
                          {t('queue')}
                          {queuePosition}
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
                        <Label>{t('resume_form')}</Label>
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
                            {t('no_input_data_provided')}
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
                            <Label>{t('display_data')}</Label>
                          </div>
                          <div style={{ padding: '16px' }}>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t('field')}</TableHead>
                                  <TableHead>{t('type')}</TableHead>
                                  <TableHead>{t('value')}</TableHead>
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
                            <Label>{t('display_data')}</Label>
                          </div>
                          <div style={{ padding: '16px' }}>
                            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                              {t('no_display_data_configured')}
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
                            <Label>{t('resume_form')}</Label>
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
                            <Label>{t('resume_input_json')}</Label>
                          </div>
                          <div style={{ padding: '16px' }}>
                            <Textarea
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
                              placeholder={t('label')}
                              rows={6}
                              spellCheck={false}
                              className='min-h-[180px] border-[var(--border-1)] bg-[var(--surface-3)] font-mono text-[12px] leading-5'
                            />
                          </div>
                        </div>
                      )}

                      {/* Messages */}
                      {error && <Badge variant='red'>{error}</Badge>}
                      {message && <Badge variant='green'>{message}</Badge>}

                      {/* Action */}
                      <Button variant='primary' onClick={handleResume} disabled={resumeDisabled}>
                        {loadingAction ? 'Resuming...' : tI18n('resume_execution')}
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
            maxWidth: '1200px',
            margin: '24px auto 0',
            padding: '0 24px 24px',
            textAlign: 'center',
            fontSize: '13px',
            color: 'var(--text-muted)',
          }}
        >
          {t('need_help')}{' '}
          <a href={`mailto:${brandConfig.supportEmail}`} style={{ color: 'var(--text-secondary)' }}>
            {t('contact_support')}
          </a>
        </div>
      </div>
    </Tooltip.Provider>
  )
}
