'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { McpTransport } from '@/lib/mcp/types'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { useMcpServerTest } from '@/hooks/queries/mcp'
import { FormField } from '../form-field/form-field'

const logger = createLogger('McpServerFormModal')

interface HeaderEntry {
  key: string
  value: string
}

interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: HeaderEntry[]
}

export interface McpServerFormConfig {
  name: string
  transport: McpTransport
  url: string
  headers: Record<string, string>
  timeout: number
}

export interface McpServerFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  initialData?: McpServerFormData
  onSubmit: (config: McpServerFormConfig) => Promise<void>
  workspaceId: string
  availableEnvVars?: Set<string>
  allowedMcpDomains: string[] | null
}

const ENV_VAR_PATTERN = /\{\{[^}]+\}\}/

function hasEnvVarInHostname(url: string): boolean {
  const globalPattern = new RegExp(ENV_VAR_PATTERN.source, 'g')
  if (url.trim().replace(globalPattern, '').trim() === '') return true
  const protocolEnd = url.indexOf('://')
  if (protocolEnd === -1) return ENV_VAR_PATTERN.test(url)
  const afterProtocol = url.substring(protocolEnd + 3)
  const authorityEnd = afterProtocol.search(/[/?#]/)
  const authority = authorityEnd === -1 ? afterProtocol : afterProtocol.substring(0, authorityEnd)
  return ENV_VAR_PATTERN.test(authority)
}

function isDomainAllowed(url: string | undefined, allowedDomains: string[] | null): boolean {
  if (allowedDomains === null) return true
  if (!url) return false
  if (hasEnvVarInHostname(url)) return true
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return allowedDomains.includes(hostname)
  } catch {
    return false
  }
}

const DEFAULT_FORM_DATA: McpServerFormData = {
  name: '',
  transport: 'streamable-http',
  url: '',
  timeout: 30000,
  headers: [{ key: '', value: '' }],
}

type InputFieldType = 'url' | 'header-key' | 'header-value'

interface EnvVarDropdownConfig {
  searchTerm: string
  cursorPosition: number
  workspaceId: string
  onSelect: (value: string) => void
  onClose: () => void
}

function getTestButtonLabel(
  testResult: { success: boolean; error?: string } | null,
  isTestingConnection: boolean
): string {
  if (isTestingConnection) return 'Testing...'
  if (testResult?.success) return 'Connection success'
  if (testResult && !testResult.success) return 'No connection: retry'
  return 'Test Connection'
}

interface FormattedInputProps {
  ref?: React.RefObject<HTMLInputElement | null>
  placeholder: string
  value: string
  scrollLeft: number
  showEnvVars: boolean
  envVarProps: EnvVarDropdownConfig
  availableEnvVars?: Set<string>
  className?: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onScroll: (scrollLeft: number) => void
}

function FormattedInput({
  ref,
  placeholder,
  value,
  scrollLeft,
  showEnvVars,
  envVarProps,
  availableEnvVars,
  className,
  onChange,
  onScroll,
}: FormattedInputProps) {
  const handleScroll = (e: { currentTarget: HTMLInputElement }) => {
    onScroll(e.currentTarget.scrollLeft)
  }

  return (
    <div className={cn('relative', className)}>
      <EmcnInput
        ref={ref}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        onInput={handleScroll}
        className='h-9 text-transparent caret-[var(--text-primary)] placeholder:text-[var(--text-muted)]'
      />
      <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-[8px] py-[6px] font-medium font-sans text-sm'>
        <div className='whitespace-nowrap' style={{ transform: `translateX(-${scrollLeft}px)` }}>
          {formatDisplayText(value, { availableEnvVars })}
        </div>
      </div>
      {showEnvVars && (
        <EnvVarDropdown
          visible={showEnvVars}
          onSelect={envVarProps.onSelect}
          searchTerm={envVarProps.searchTerm}
          inputValue={value}
          cursorPosition={envVarProps.cursorPosition}
          workspaceId={envVarProps.workspaceId}
          onClose={envVarProps.onClose}
          className='w-full'
          maxHeight='200px'
          style={{ position: 'absolute', top: '100%', left: 0, zIndex: 99999 }}
        />
      )}
    </div>
  )
}

interface HeaderRowProps {
  header: HeaderEntry
  index: number
  headerScrollLeft: Record<string, number>
  showEnvVars: boolean
  activeInputField: InputFieldType | null
  activeHeaderIndex: number | null
  envSearchTerm: string
  cursorPosition: number
  workspaceId: string
  availableEnvVars?: Set<string>
  onInputChange: (field: InputFieldType, value: string, index?: number) => void
  onHeaderScroll: (key: string, scrollLeft: number) => void
  onEnvVarSelect: (value: string) => void
  onEnvVarClose: () => void
}

function HeaderRow({
  header,
  index,
  headerScrollLeft,
  showEnvVars,
  activeInputField,
  activeHeaderIndex,
  envSearchTerm,
  cursorPosition,
  workspaceId,
  availableEnvVars,
  onInputChange,
  onHeaderScroll,
  onEnvVarSelect,
  onEnvVarClose,
}: HeaderRowProps) {
  const isKeyActive =
    showEnvVars && activeInputField === 'header-key' && activeHeaderIndex === index
  const isValueActive =
    showEnvVars && activeInputField === 'header-value' && activeHeaderIndex === index

  const envVarProps: EnvVarDropdownConfig = {
    searchTerm: envSearchTerm,
    cursorPosition,
    workspaceId,
    onSelect: onEnvVarSelect,
    onClose: onEnvVarClose,
  }

  return (
    <div className='relative flex items-center gap-[8px]'>
      <FormattedInput
        placeholder='Name'
        value={header.key || ''}
        scrollLeft={headerScrollLeft[`key-${index}`] || 0}
        showEnvVars={isKeyActive}
        envVarProps={envVarProps}
        availableEnvVars={availableEnvVars}
        className='flex-1'
        onChange={(e) => onInputChange('header-key', e.target.value, index)}
        onScroll={(sl) => onHeaderScroll(`key-${index}`, sl)}
      />

      <FormattedInput
        placeholder='Value'
        value={header.value || ''}
        scrollLeft={headerScrollLeft[`value-${index}`] || 0}
        showEnvVars={isValueActive}
        envVarProps={envVarProps}
        availableEnvVars={availableEnvVars}
        className='flex-1'
        onChange={(e) => onInputChange('header-value', e.target.value, index)}
        onScroll={(sl) => onHeaderScroll(`value-${index}`, sl)}
      />
    </div>
  )
}

function headersToRecord(headers: HeaderEntry[] | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  for (const header of headers || []) {
    if (header.key.trim()) {
      record[header.key] = header.value
    }
  }
  return record
}

function extractStringHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== 'object' || headers === null) return {}
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/**
 * Updates a headers array with auto-add (new empty row when typing in last)
 * and auto-remove (drop non-last empty rows).
 */
function updateHeadersArray(
  headers: HeaderEntry[],
  index: number,
  field: 'key' | 'value',
  value: string
): HeaderEntry[] {
  const updated = [...headers]
  if (updated[index]) {
    updated[index] = { ...updated[index], [field]: value }
  }

  const lastIdx = updated.length - 1
  if (index === lastIdx && updated[lastIdx] && (updated[lastIdx].key || updated[lastIdx].value)) {
    updated.push({ key: '', value: '' })
  }

  const lastIndex = updated.length - 1
  return updated.filter((h, i) => i === lastIndex || h.key !== '' || h.value !== '')
}

export function McpServerFormModal({
  open,
  onOpenChange,
  mode,
  initialData,
  onSubmit,
  workspaceId,
  availableEnvVars,
  allowedMcpDomains,
}: McpServerFormModalProps) {
  const urlInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [originalData, setOriginalData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)

  const [formMode, setFormMode] = useState<'form' | 'json'>('form')
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<InputFieldType | null>(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)
  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})

  const [prevOpen, setPrevOpen] = useState(false)
  if (open && !prevOpen) {
    const data = initialData ?? DEFAULT_FORM_DATA
    setFormData(data)
    setOriginalData(JSON.parse(JSON.stringify(data)))
    setFormMode('form')
    setJsonInput('')
    setJsonError(null)
    setIsSubmitting(false)
    setSubmitError(null)
    setShowEnvVars(false)
    setActiveInputField(null)
    setActiveHeaderIndex(null)
    setUrlScrollLeft(0)
    setHeaderScrollLeft({})
  }
  if (open !== prevOpen) {
    setPrevOpen(open)
  }

  // Clear stale TanStack Query mutation state when the modal opens.
  // mutation.reset() is a side effect that can't be called during render.
  useEffect(() => {
    if (open) {
      clearTestResult()
    }
  }, [open, clearTestResult])

  const resetEnvVarState = useCallback(() => {
    setShowEnvVars(false)
    setActiveInputField(null)
    setActiveHeaderIndex(null)
  }, [])

  const handleInputChange = useCallback(
    (field: InputFieldType, value: string, headerIndex?: number) => {
      const input = document.activeElement as HTMLInputElement
      const pos = input?.selectionStart || 0
      setCursorPosition(pos)

      if (testResult) clearTestResult()
      if (submitError) setSubmitError(null)

      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show)
      setEnvSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      if (envVarTrigger.show) {
        setActiveInputField(field)
        setActiveHeaderIndex(headerIndex ?? null)
      } else {
        resetEnvVarState()
      }

      if (field === 'url') {
        setFormData((prev) => ({ ...prev, url: value }))
      } else if (headerIndex !== undefined) {
        const headerField = field === 'header-key' ? 'key' : 'value'
        setFormData((prev) => ({
          ...prev,
          headers: updateHeadersArray(prev.headers || [], headerIndex, headerField, value),
        }))
      }
    },
    [testResult, clearTestResult, submitError, resetEnvVarState]
  )

  const handleEnvVarSelect = useCallback(
    (newValue: string) => {
      if (activeInputField === 'url') {
        setFormData((prev) => ({ ...prev, url: newValue }))
      } else if (activeHeaderIndex !== null) {
        const field = activeInputField === 'header-key' ? 'key' : 'value'
        const processedValue = field === 'key' ? newValue.replace(/[{}]/g, '') : newValue
        setFormData((prev) => ({
          ...prev,
          headers: updateHeadersArray(prev.headers || [], activeHeaderIndex, field, processedValue),
        }))
      }
      resetEnvVarState()
    },
    [activeInputField, activeHeaderIndex, resetEnvVarState]
  )

  const handleHeaderScroll = useCallback((key: string, sl: number) => {
    setHeaderScrollLeft((prev) => ({ ...prev, [key]: sl }))
  }, [])

  const isDomainBlocked =
    !!formData.url?.trim() && !isDomainAllowed(formData.url, allowedMcpDomains)
  const isFormValid = !!(formData.name.trim() && formData.url?.trim())
  const testButtonLabel = getTestButtonLabel(testResult, isTestingConnection)

  const hasChanges = useMemo(() => {
    if (mode === 'add') return true
    if (formData.name !== originalData.name) return true
    if (formData.url !== originalData.url) return true
    if (formData.transport !== originalData.transport) return true
    const currentHeaders = formData.headers || []
    const origHeaders = originalData.headers || []
    if (currentHeaders.length !== origHeaders.length) return true
    for (let i = 0; i < currentHeaders.length; i++) {
      if (
        currentHeaders[i].key !== origHeaders[i].key ||
        currentHeaders[i].value !== origHeaders[i].value
      )
        return true
    }
    return false
  }, [mode, formData, originalData])

  const parseJsonConfig = useCallback(
    (json: string): { name: string; url: string; headers: Record<string, string> } | null => {
      try {
        const parsed = JSON.parse(json)

        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          const entries = Object.entries(parsed.mcpServers)
          if (entries.length === 0) {
            setJsonError('No servers found in mcpServers')
            return null
          }
          if (entries.length > 1) {
            setJsonError(
              `Only the first server ("${entries[0][0]}") will be imported. Paste each config separately to add others.`
            )
          }
          const [name, config] = entries[0] as [string, Record<string, unknown>]
          if (!config.url || typeof config.url !== 'string') {
            setJsonError('Server config must include a "url" field')
            return null
          }
          if (entries.length <= 1) setJsonError(null)
          return { name, url: config.url, headers: extractStringHeaders(config.headers) }
        }

        if (parsed.url && typeof parsed.url === 'string') {
          setJsonError(null)
          return { name: '', url: parsed.url, headers: extractStringHeaders(parsed.headers) }
        }

        setJsonError('JSON must contain "mcpServers" or a "url" field')
        return null
      } catch {
        setJsonError('Invalid JSON')
        return null
      }
    },
    []
  )

  const handleTestConnection = useCallback(async () => {
    if (!isFormValid) return

    await testConnection({
      name: formData.name,
      transport: formData.transport,
      url: formData.url!,
      headers: headersToRecord(formData.headers),
      timeout: formData.timeout,
      workspaceId,
    })
  }, [formData, isFormValid, testConnection, workspaceId])

  const handleSubmitForm = useCallback(async () => {
    if (!isFormValid || isDomainBlocked) return

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const headers = headersToRecord(formData.headers)
      const connectionResult = await testConnection({
        name: formData.name,
        transport: formData.transport,
        url: formData.url!,
        headers,
        timeout: formData.timeout,
        workspaceId,
      })

      if (!connectionResult.success) {
        setSubmitError(
          connectionResult.error || 'Connection test failed. Please check the URL and try again.'
        )
        return
      }

      await onSubmit({
        name: formData.name.trim(),
        transport: formData.transport,
        url: formData.url!,
        headers,
        timeout: formData.timeout || 30000,
      })

      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save server'
      setSubmitError(message)
      logger.error('Failed to save MCP server:', error)
    } finally {
      setIsSubmitting(false)
    }
  }, [formData, isFormValid, isDomainBlocked, testConnection, workspaceId, onSubmit, onOpenChange])

  const handleSubmitJson = useCallback(async () => {
    const config = parseJsonConfig(jsonInput)
    if (!config) return

    if (!config.name) {
      setJsonError('Server name is required. Use: { "mcpServers": { "name": { "url": "..." } } }')
      return
    }

    if (!isDomainAllowed(config.url, allowedMcpDomains)) {
      setJsonError('Domain not permitted by server policy')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const connectionResult = await testConnection({
        name: config.name,
        transport: 'streamable-http',
        url: config.url,
        headers: config.headers,
        timeout: 30000,
        workspaceId,
      })

      if (!connectionResult.success) {
        setSubmitError(
          connectionResult.error || 'Connection test failed. Please check the URL and try again.'
        )
        return
      }

      await onSubmit({
        name: config.name,
        transport: 'streamable-http',
        url: config.url,
        headers: config.headers,
        timeout: 30000,
      })

      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save server'
      setSubmitError(message)
      logger.error('Failed to save MCP server from JSON:', error)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    jsonInput,
    parseJsonConfig,
    allowedMcpDomains,
    testConnection,
    workspaceId,
    onSubmit,
    onOpenChange,
  ])

  const isSubmitDisabled =
    isSubmitting || !isFormValid || isDomainBlocked || (mode === 'edit' && !hasChanges)

  const title = mode === 'add' ? 'Add New MCP Server' : 'Edit MCP Server'
  const submitLabel = mode === 'add' ? 'Add MCP' : 'Save'

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          {formMode === 'json' ? (
            <div className='flex flex-col gap-[8px]'>
              <Textarea
                placeholder={`{\n  "mcpServers": {\n    "server-name": {\n      "url": "https://...",\n      "headers": {\n        "X-API-Key": "..."\n      }\n    }\n  }\n}`}
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value)
                  if (jsonError) setJsonError(null)
                  if (testResult) clearTestResult()
                  if (submitError) setSubmitError(null)
                }}
                className='min-h-[200px] font-mono text-[13px]'
              />
              {jsonError && <p className='text-[12px] text-[var(--text-error)]'>{jsonError}</p>}
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              <FormField label='Server Name'>
                <EmcnInput
                  placeholder='e.g., My MCP Server'
                  value={formData.name}
                  onChange={(e) => {
                    if (testResult) clearTestResult()
                    if (submitError) setSubmitError(null)
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }}
                  className='h-9'
                />
              </FormField>

              <FormField label='Server URL'>
                <FormattedInput
                  ref={urlInputRef}
                  placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
                  value={formData.url || ''}
                  scrollLeft={urlScrollLeft}
                  showEnvVars={showEnvVars && activeInputField === 'url'}
                  envVarProps={{
                    searchTerm: envSearchTerm,
                    cursorPosition,
                    workspaceId,
                    onSelect: handleEnvVarSelect,
                    onClose: resetEnvVarState,
                  }}
                  availableEnvVars={availableEnvVars}
                  onChange={(e) => handleInputChange('url', e.target.value)}
                  onScroll={setUrlScrollLeft}
                />
                {isDomainBlocked && (
                  <p className='mt-[4px] text-[12px] text-[var(--text-error)]'>
                    Domain not permitted by server policy
                  </p>
                )}
              </FormField>

              <div className='flex flex-col gap-[8px]'>
                <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  Headers
                </span>
                <div className='flex max-h-[140px] flex-col gap-[8px] overflow-y-auto'>
                  {(formData.headers || []).map((header, index) => (
                    <HeaderRow
                      key={index}
                      header={header}
                      index={index}
                      headerScrollLeft={headerScrollLeft}
                      showEnvVars={showEnvVars}
                      activeInputField={activeInputField}
                      activeHeaderIndex={activeHeaderIndex}
                      envSearchTerm={envSearchTerm}
                      cursorPosition={cursorPosition}
                      workspaceId={workspaceId}
                      availableEnvVars={availableEnvVars}
                      onInputChange={handleInputChange}
                      onHeaderScroll={handleHeaderScroll}
                      onEnvVarSelect={handleEnvVarSelect}
                      onEnvVarClose={resetEnvVarState}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {submitError && (
            <p className='mb-[8px] w-full text-[13px] text-[var(--text-error)]'>{submitError}</p>
          )}
          <div className='flex w-full items-center justify-between'>
            <div className='flex items-center gap-[8px]'>
              {mode === 'add' && (
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => {
                    if (testResult) clearTestResult()
                    setFormMode(formMode === 'form' ? 'json' : 'form')
                    setJsonError(null)
                    setSubmitError(null)
                  }}
                >
                  {formMode === 'form' ? 'Edit JSON' : 'Edit Form'}
                </Button>
              )}
              {mode === 'edit' && formMode === 'form' && (
                <Button
                  variant='default'
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !isFormValid || isDomainBlocked}
                >
                  {testButtonLabel}
                </Button>
              )}
            </div>
            <div className='flex items-center gap-[8px]'>
              <Button variant='ghost' onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {formMode === 'json' ? (
                <Button
                  onClick={handleSubmitJson}
                  disabled={isSubmitting || !jsonInput.trim()}
                  variant='primary'
                >
                  {isSubmitting ? 'Adding...' : submitLabel}
                </Button>
              ) : (
                <Button onClick={handleSubmitForm} disabled={isSubmitDisabled} variant='primary'>
                  {isSubmitting ? (mode === 'add' ? 'Adding...' : 'Saving...') : submitLabel}
                </Button>
              )}
            </div>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
