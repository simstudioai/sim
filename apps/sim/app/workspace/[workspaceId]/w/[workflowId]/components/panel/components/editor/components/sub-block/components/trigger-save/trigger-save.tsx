import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/emcn/components'
import { createLogger } from '@/lib/logs/console/logger'
import { SaveStatusIndicator } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/save-status-indicator/save-status-indicator'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input/short-input'
import { useAutoSave } from '@/hooks/use-auto-save'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { getTriggerConfigAggregation } from '@/hooks/use-trigger-config-aggregation'
import { useWebhookManagement } from '@/hooks/use-webhook-management'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('TriggerSave')

interface TriggerSaveProps {
  blockId: string
  subBlockId: string
  triggerId?: string
  isPreview?: boolean
  disabled?: boolean
}

export function TriggerSave({
  blockId,
  subBlockId,
  triggerId,
  isPreview = false,
  disabled = false,
}: TriggerSaveProps) {
  const [isGeneratingTestUrl, setIsGeneratingTestUrl] = useState(false)
  const [testUrlError, setTestUrlError] = useState<string | null>(null)

  const storedTestUrl = useSubBlockStore((state) => state.getValue(blockId, 'testUrl'))
  const storedTestUrlExpiresAt = useSubBlockStore((state) =>
    state.getValue(blockId, 'testUrlExpiresAt')
  )

  const isTestUrlExpired = useMemo(() => {
    if (!storedTestUrlExpiresAt) return true
    return new Date(storedTestUrlExpiresAt) < new Date()
  }, [storedTestUrlExpiresAt])

  const testUrl = isTestUrlExpired ? null : (storedTestUrl as string | null)
  const testUrlExpiresAt = isTestUrlExpired ? null : (storedTestUrlExpiresAt as string | null)

  const effectiveTriggerId = useMemo(() => {
    if (triggerId && isTriggerValid(triggerId)) {
      return triggerId
    }
    const selectedTriggerId = useSubBlockStore.getState().getValue(blockId, 'selectedTriggerId')
    if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
      return selectedTriggerId
    }
    return triggerId
  }, [blockId, triggerId])

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  const { webhookId, saveConfig, isLoading } = useWebhookManagement({
    blockId,
    triggerId: effectiveTriggerId,
    isPreview,
  })

  const triggerCredentials = useSubBlockStore((state) =>
    state.getValue(blockId, 'triggerCredentials')
  )

  const triggerDef =
    effectiveTriggerId && isTriggerValid(effectiveTriggerId) ? getTrigger(effectiveTriggerId) : null

  const hasWebhookUrlDisplay =
    triggerDef?.subBlocks.some((sb) => sb.id === 'webhookUrlDisplay') ?? false

  const validateRequiredFields = useCallback((): boolean => {
    if (!triggerDef) return true

    const aggregatedConfig = getTriggerConfigAggregation(blockId, effectiveTriggerId)

    const requiredSubBlocks = triggerDef.subBlocks.filter(
      (sb) => sb.required && sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id)
    )

    for (const subBlock of requiredSubBlocks) {
      if (subBlock.id === 'triggerCredentials') {
        if (!triggerCredentials) return false
      } else {
        const value = aggregatedConfig?.[subBlock.id]
        if (value === undefined || value === null || value === '') return false
      }
    }

    return true
  }, [triggerDef, triggerCredentials, blockId, effectiveTriggerId])

  const requiredSubBlockIds = useMemo(() => {
    if (!triggerDef) return []
    return triggerDef.subBlocks
      .filter((sb) => sb.required && sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
      .map((sb) => sb.id)
  }, [triggerDef])

  const subscribedSubBlockValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!triggerDef) return {}
        const values: Record<string, unknown> = {}
        requiredSubBlockIds.forEach((id) => {
          const value = state.getValue(blockId, id)
          if (value !== null && value !== undefined && value !== '') {
            values[id] = value
          }
        })
        return values
      },
      [blockId, triggerDef, requiredSubBlockIds]
    )
  )

  const configFingerprint = useMemo(() => {
    return JSON.stringify({ ...subscribedSubBlockValues, triggerCredentials })
  }, [subscribedSubBlockValues, triggerCredentials])

  useEffect(() => {
    if (isTestUrlExpired && storedTestUrl) {
      useSubBlockStore.getState().setValue(blockId, 'testUrl', null)
      useSubBlockStore.getState().setValue(blockId, 'testUrlExpiresAt', null)
    }
  }, [blockId, isTestUrlExpired, storedTestUrl])

  const handleSave = useCallback(async () => {
    const aggregatedConfig = getTriggerConfigAggregation(blockId, effectiveTriggerId)

    if (aggregatedConfig) {
      useSubBlockStore.getState().setValue(blockId, 'triggerConfig', aggregatedConfig)
    }

    return saveConfig()
  }, [blockId, effectiveTriggerId, saveConfig])

  const handleSaveSuccess = useCallback(() => {
    const savedWebhookId = useSubBlockStore.getState().getValue(blockId, 'webhookId')
    const savedTriggerPath = useSubBlockStore.getState().getValue(blockId, 'triggerPath')
    const savedTriggerId = useSubBlockStore.getState().getValue(blockId, 'triggerId')
    const savedTriggerConfig = useSubBlockStore.getState().getValue(blockId, 'triggerConfig')

    collaborativeSetSubblockValue(blockId, 'webhookId', savedWebhookId)
    collaborativeSetSubblockValue(blockId, 'triggerPath', savedTriggerPath)
    collaborativeSetSubblockValue(blockId, 'triggerId', savedTriggerId)
    collaborativeSetSubblockValue(blockId, 'triggerConfig', savedTriggerConfig)
  }, [blockId, collaborativeSetSubblockValue])

  const {
    saveStatus,
    errorMessage,
    retryCount,
    maxRetries,
    triggerSave,
    onConfigChange,
    markInitialLoadComplete,
  } = useAutoSave({
    disabled: isPreview || disabled || !triggerDef,
    isExternallySaving: isLoading,
    validate: validateRequiredFields,
    onSave: handleSave,
    onSaveSuccess: handleSaveSuccess,
    loggerName: 'TriggerSave',
  })

  useEffect(() => {
    onConfigChange(configFingerprint)
  }, [configFingerprint, onConfigChange])

  useEffect(() => {
    if (!isLoading && webhookId) {
      return markInitialLoadComplete(configFingerprint)
    }
    if (!webhookId && !isLoading) {
      return markInitialLoadComplete(configFingerprint)
    }
  }, [isLoading, webhookId, configFingerprint, markInitialLoadComplete])

  const generateTestUrl = async () => {
    if (!webhookId) return
    try {
      setIsGeneratingTestUrl(true)
      setTestUrlError(null)
      const res = await fetch(`/api/webhooks/${webhookId}/test-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'Failed to generate test URL')
      }
      const json = await res.json()
      useSubBlockStore.getState().setValue(blockId, 'testUrl', json.url)
      useSubBlockStore.getState().setValue(blockId, 'testUrlExpiresAt', json.expiresAt)
      collaborativeSetSubblockValue(blockId, 'testUrl', json.url)
      collaborativeSetSubblockValue(blockId, 'testUrlExpiresAt', json.expiresAt)
    } catch (e) {
      logger.error('Failed to generate test webhook URL', { error: e })
      setTestUrlError(
        e instanceof Error ? e.message : 'Failed to generate test URL. Please try again.'
      )
    } finally {
      setIsGeneratingTestUrl(false)
    }
  }

  if (isPreview) {
    return null
  }

  const isProcessing = saveStatus === 'saving' || isLoading
  const displayError = errorMessage || testUrlError

  const hasStatusIndicator = isLoading || saveStatus === 'saving' || displayError
  const hasTestUrlSection =
    webhookId && hasWebhookUrlDisplay && !isLoading && saveStatus !== 'saving'

  if (!hasStatusIndicator && !hasTestUrlSection) {
    return null
  }

  return (
    <div id={`${blockId}-${subBlockId}`} className='space-y-2 pb-4'>
      <SaveStatusIndicator
        status={saveStatus}
        errorMessage={displayError}
        savingText='Saving trigger...'
        loadingText='Loading trigger...'
        isLoading={isLoading}
        onRetry={testUrlError ? () => setTestUrlError(null) : triggerSave}
        retryDisabled={isProcessing}
        retryCount={retryCount}
        maxRetries={maxRetries}
      />

      {/* Test webhook URL section */}
      {webhookId && hasWebhookUrlDisplay && !isLoading && saveStatus !== 'saving' && (
        <div className='space-y-1'>
          <div className='flex items-center justify-between'>
            <span className='font-medium text-sm'>Test Webhook URL</span>
            <Button
              variant='ghost'
              onClick={generateTestUrl}
              disabled={isGeneratingTestUrl || isProcessing}
              className='h-6 px-2 py-1 text-[11px]'
            >
              {isGeneratingTestUrl ? (
                <>
                  <div className='mr-1.5 h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
                  Generating…
                </>
              ) : testUrl ? (
                'Regenerate'
              ) : (
                'Generate'
              )}
            </Button>
          </div>
          {testUrl ? (
            <ShortInput
              blockId={blockId}
              subBlockId={`${subBlockId}-test-url`}
              config={{
                id: `${subBlockId}-test-url`,
                type: 'short-input',
                readOnly: true,
                showCopyButton: true,
              }}
              value={testUrl}
              readOnly={true}
              showCopyButton={true}
              disabled={isPreview || disabled}
              isPreview={isPreview}
            />
          ) : (
            <p className='text-muted-foreground text-xs'>
              Generate a temporary URL that executes this webhook against the live (undeployed)
              workflow state.
            </p>
          )}
          {testUrlExpiresAt && (
            <p className='text-muted-foreground text-xs'>
              Expires at {new Date(testUrlExpiresAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
