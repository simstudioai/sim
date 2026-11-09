'use client'

import { useEffect, useId, useState } from 'react'
import { Disclosure } from '@sim/emcn/disclosure'
import { FieldFrame, fieldDescription, TextAreaField, TextField } from '@sim/emcn/field'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { EnvVarInput } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/mcp-server-form/env-var-input'
import {
  getTestButtonLabel,
  type HeaderEntry,
  headersToRecord,
  isDomainAllowed,
  parseJsonConfig,
  updateHeadersArray,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/mcp-server-form/form-model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form.module.css'
import { type McpAuthType, type McpTransport, useMcpServerTest } from '@/platform/lib/data/mcp'

const DEFAULT_TIMEOUT_MS = 30000
const DOMAIN_BLOCKED_MESSAGE = 'Domain not permitted by server policy'
const CONNECTION_FAILED_MESSAGE = 'Connection test failed. Please check the URL and try again.'
const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "server-name": {
      "url": "https://...",
      "headers": {
        "X-API-Key": "..."
      }
    }
  }
}`

interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: HeaderEntry[]
  oauthClientId?: string
  oauthClientSecret?: string
  hasOauthClientSecret?: boolean
}

/** What the form submits: a tested server configuration ready to create or update. */
export interface McpServerFormConfig {
  name: string
  transport: McpTransport
  url: string
  headers: Record<string, string>
  timeout: number
  oauthClientId?: string
  oauthClientSecret?: string
  authType?: McpAuthType
}

interface McpServerFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  initialData?: McpServerFormData
  onSubmit: (config: McpServerFormConfig) => Promise<void>
  workspaceId: string
  availableEnvVars?: Set<string>
  allowedMcpDomains: string[] | null
  domainPolicyUnavailable?: boolean
  domainPolicyError?: string
  /** False locks the URL field: the server refuses a destination change from a non-admin. */
  canChangeDestination?: boolean
}

const DEFAULT_FORM_DATA: McpServerFormData = {
  name: '',
  transport: 'streamable-http',
  url: '',
  timeout: DEFAULT_TIMEOUT_MS,
  headers: [{ key: '', value: '' }],
}

function headersChanged(current: HeaderEntry[], original: HeaderEntry[]): boolean {
  if (current.length !== original.length) return true
  return current.some(
    (header, index) => header.key !== original[index].key || header.value !== original[index].value
  )
}

/**
 * Adds or edits an MCP server: a name, a URL and headers that may hold `{{SECRET}}` references,
 * and an optional OAuth client. Every save tests the connection first; adding also accepts a
 * pasted `mcpServers` JSON block.
 */
export function McpServerFormModal({
  open,
  onOpenChange,
  mode,
  initialData,
  onSubmit,
  workspaceId,
  availableEnvVars,
  allowedMcpDomains,
  domainPolicyUnavailable = false,
  domainPolicyError,
  canChangeDestination = true,
}: McpServerFormModalProps) {
  const urlId = useId()
  const headersEdges = useScrollEdges<HTMLDivElement>()

  const [formData, setFormData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [originalData, setOriginalData] = useState<McpServerFormData>(DEFAULT_FORM_DATA)
  const [formMode, setFormMode] = useState<'form' | 'json'>('form')
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [oauthClientSecretTouched, setOauthClientSecretTouched] = useState(false)

  const { testResult, isTestingConnection, testConnection, clearTestResult } = useMcpServerTest()

  const [prevOpen, setPrevOpen] = useState(false)
  if (open && !prevOpen) {
    const data = initialData ?? DEFAULT_FORM_DATA
    setFormData(data)
    setOriginalData(structuredClone(data))
    setFormMode('form')
    setJsonInput('')
    setJsonError(null)
    setIsSubmitting(false)
    setShowAdvanced(!!(data.oauthClientId || data.oauthClientSecret || data.hasOauthClientSecret))
    setOauthClientSecretTouched(false)
  }
  if (open !== prevOpen) {
    setPrevOpen(open)
  }

  // A mutation reset is a side effect, so the last session's test result clears after render.
  useEffect(() => {
    if (open) clearTestResult()
  }, [open, clearTestResult])

  const clearFeedback = () => {
    if (testResult) clearTestResult()
  }

  const url = formData.url ?? ''
  const isDomainBlocked = !!url.trim() && !isDomainAllowed(url, allowedMcpDomains)
  const isFormValid = !!(formData.name.trim() && url.trim())

  const hasChanges =
    mode === 'add' ||
    formData.name !== originalData.name ||
    formData.url !== originalData.url ||
    formData.transport !== originalData.transport ||
    (formData.oauthClientId || '') !== (originalData.oauthClientId || '') ||
    oauthClientSecretTouched ||
    headersChanged(formData.headers || [], originalData.headers || [])

  const testConfig = () => ({
    name: formData.name,
    transport: formData.transport,
    url,
    headers: headersToRecord(formData.headers),
    timeout: formData.timeout,
    workspaceId,
  })

  const handleTestConnection = async () => {
    if (!isFormValid || domainPolicyUnavailable) return
    try {
      await testConnection(testConfig())
    } catch {
      // The hook reports a failed test through `testResult`, which labels the action.
    }
  }

  /** Tests the connection, then submits; any failure rejects with the message the dialog shows. */
  const submitTested = async (
    test: Parameters<typeof testConnection>[0],
    build: (authType: McpAuthType | undefined) => McpServerFormConfig
  ): Promise<undefined> => {
    setIsSubmitting(true)
    try {
      const connectionResult = await testConnection(test)
      if (!connectionResult.success && !connectionResult.authRequired) {
        throw new Error(connectionResult.error || CONNECTION_FAILED_MESSAGE)
      }
      await onSubmit(build(connectionResult.authType))
    } catch (error) {
      throw new Error(getErrorMessage(error, 'Failed to save server'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitForm = async (): Promise<false | undefined> => {
    if (!isFormValid || isDomainBlocked || domainPolicyUnavailable) return false
    const config = testConfig()
    const oauthClientId = formData.oauthClientId?.trim()
    const oauthClientSecret = formData.oauthClientSecret?.trim()
    const oauthClientIdChanged = (oauthClientId || '') !== (originalData.oauthClientId || '').trim()
    return submitTested(config, (authType) => ({
      name: formData.name.trim(),
      transport: formData.transport,
      url,
      headers: config.headers,
      timeout: formData.timeout || DEFAULT_TIMEOUT_MS,
      authType,
      oauthClientId:
        mode === 'edit'
          ? oauthClientIdChanged
            ? (oauthClientId ?? '')
            : undefined
          : oauthClientId || undefined,
      oauthClientSecret:
        mode === 'edit'
          ? oauthClientSecretTouched
            ? (oauthClientSecret ?? '')
            : undefined
          : oauthClientSecret || undefined,
    }))
  }

  const handleSubmitJson = async (): Promise<false | undefined> => {
    if (domainPolicyUnavailable) return false
    const { config, message } = parseJsonConfig(jsonInput)
    setJsonError(message)
    if (!config) return false
    if (!config.name) {
      setJsonError('Server name is required. Use: { "mcpServers": { "name": { "url": "..." } } }')
      return false
    }
    if (!isDomainAllowed(config.url, allowedMcpDomains)) {
      setJsonError(DOMAIN_BLOCKED_MESSAGE)
      return false
    }
    const submitted = {
      ...config,
      transport: 'streamable-http' as const,
      timeout: DEFAULT_TIMEOUT_MS,
    }
    return submitTested({ ...submitted, workspaceId }, (authType) => ({ ...submitted, authType }))
  }

  const handleToggleJsonMode = () => {
    clearFeedback()
    setFormMode(formMode === 'form' ? 'json' : 'form')
    setJsonError(null)
  }

  const setHeaderCell = (index: number, field: 'key' | 'value', value: string) => {
    clearFeedback()
    setFormData((prev) => ({
      ...prev,
      headers: updateHeadersArray(prev.headers || [], index, field, value),
    }))
  }

  const isJsonMode = formMode === 'json'
  const confirmDisabled = isJsonMode
    ? domainPolicyUnavailable || isSubmitting || !jsonInput.trim()
    : domainPolicyUnavailable ||
      isSubmitting ||
      !isFormValid ||
      isDomainBlocked ||
      (mode === 'edit' && !hasChanges)
  const submitLabel = mode === 'add' ? 'Add server' : 'Save'
  const pendingLabel = mode === 'add' || isJsonMode ? 'Adding…' : 'Saving…'
  const urlError = isDomainBlocked ? DOMAIN_BLOCKED_MESSAGE : undefined
  const urlHint = canChangeDestination
    ? undefined
    : 'Only workspace admins can change the server URL'

  const footerStartAction =
    mode === 'add'
      ? { label: isJsonMode ? 'Edit form' : 'Edit JSON', onClick: handleToggleJsonMode }
      : isJsonMode
        ? undefined
        : {
            label: getTestButtonLabel(testResult, isTestingConnection),
            onClick: () => void handleTestConnection(),
            disabled:
              domainPolicyUnavailable || isTestingConnection || !isFormValid || isDomainBlocked,
          }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'add' ? 'Add MCP server' : 'Edit MCP server'}
      confirmLabel={isSubmitting ? pendingLabel : submitLabel}
      confirmDisabled={confirmDisabled}
      footerStartAction={footerStartAction}
      onConfirm={isJsonMode ? handleSubmitJson : handleSubmitForm}
    >
      {isJsonMode ? (
        <TextAreaField
          label='Configuration'
          value={jsonInput}
          onChange={(value) => {
            setJsonInput(value)
            setJsonError(null)
            clearFeedback()
          }}
          placeholder={JSON_PLACEHOLDER}
          defaultSize='large'
          spellCheck={false}
          autoComplete='off'
          error={jsonError ?? undefined}
        />
      ) : (
        <>
          <AutofillDecoys />
          <TextField
            label='Server name'
            value={formData.name}
            onChange={(name) => {
              clearFeedback()
              setFormData((prev) => ({ ...prev, name }))
            }}
            placeholder='e.g., My MCP Server'
            autoComplete='off'
          />
          <FieldFrame id={urlId} label='Server URL' error={urlError} hint={urlHint}>
            <EnvVarInput
              id={urlId}
              label='Server URL'
              placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
              value={url}
              onChange={(next) => {
                clearFeedback()
                setFormData((prev) => ({ ...prev, url: next }))
              }}
              workspaceId={workspaceId}
              availableEnvVars={availableEnvVars}
              disabled={!canChangeDestination}
              invalid={isDomainBlocked}
              describedBy={fieldDescription(urlId, urlError, urlHint)}
            />
          </FieldFrame>
          <FieldFrame label='Headers'>
            <div ref={headersEdges} className={styles.headers}>
              {(formData.headers || []).map((header, index) => (
                // Rows are positional: an emptied row collapses and the next takes its place.
                <div key={index} className={styles.headerRow}>
                  <EnvVarInput
                    label={`Header ${index + 1} name`}
                    placeholder='Name'
                    value={header.key}
                    onChange={(value) => setHeaderCell(index, 'key', value)}
                    workspaceId={workspaceId}
                    availableEnvVars={availableEnvVars}
                    stripReferenceBraces
                  />
                  <EnvVarInput
                    label={`Header ${index + 1} value`}
                    placeholder='Value'
                    value={header.value}
                    onChange={(value) => setHeaderCell(index, 'value', value)}
                    workspaceId={workspaceId}
                    availableEnvVars={availableEnvVars}
                  />
                </div>
              ))}
            </div>
          </FieldFrame>
          <Disclosure
            label='Advanced settings'
            open={showAdvanced}
            onOpenChange={setShowAdvanced}
            chevron
          >
            <div className={styles.advanced}>
              <TextField
                label='Client ID'
                optional
                name='mcp_oauth_client_id'
                value={formData.oauthClientId || ''}
                onChange={(oauthClientId) => {
                  clearFeedback()
                  setFormData((prev) => ({ ...prev, oauthClientId }))
                }}
                placeholder='OAuth client ID'
                autoComplete='off'
              />
              <SecretField
                label='Client secret'
                optional
                name='mcp_oauth_client_secret'
                value={formData.oauthClientSecret || ''}
                onChange={(oauthClientSecret) => {
                  clearFeedback()
                  setOauthClientSecretTouched(oauthClientSecret.length > 0)
                  setFormData((prev) => ({ ...prev, oauthClientSecret }))
                }}
                placeholder='OAuth client secret'
                autoComplete='new-password'
                hint="Only needed for servers that don't support automatic client registration."
              />
            </div>
          </Disclosure>
        </>
      )}
      {domainPolicyError && <InlineNotice intent='danger' message={domainPolicyError} />}
    </Modal>
  )
}
