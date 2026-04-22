'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeftRight, ExternalLink, Loader2, RotateCcw } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  Skeleton,
  Tooltip,
} from '@/components/emcn'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field'
import { SYNC_INTERVALS } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfig, ConnectorConfigField } from '@/connectors/types'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'
import {
  useConnectorDocuments,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import type { SelectorKey } from '@/hooks/selectors/types'

const logger = createLogger('EditConnectorModal')

/** Keys injected by the sync engine — not user-editable */
const INTERNAL_CONFIG_KEYS = new Set(['tagSlotMapping', 'disabledTagIds'])

interface EditConnectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  connector: ConnectorData
}

export function EditConnectorModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  connector,
}: EditConnectorModalProps) {
  const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType] ?? null

  const [activeTab, setActiveTab] = useState('settings')
  const [syncInterval, setSyncInterval] = useState(connector.syncIntervalMinutes)
  const [error, setError] = useState<string | null>(null)

  /**
   * Seeds from the stored canonical config. For canonical-pair fields (selector +
   * manual input), both field IDs get the same value so toggling preserves it.
   * Captured once on mount; editing state is owned by the hook afterward.
   */
  const [initialSourceConfig] = useState<Record<string, string>>(() => {
    const config: Record<string, string> = {}
    if (!connectorConfig) {
      for (const [key, value] of Object.entries(connector.sourceConfig)) {
        if (!INTERNAL_CONFIG_KEYS.has(key)) config[key] = String(value ?? '')
      }
      return config
    }
    for (const field of connectorConfig.configFields) {
      const canonicalId = field.canonicalParamId ?? field.id
      if (INTERNAL_CONFIG_KEYS.has(canonicalId)) continue
      const rawValue = connector.sourceConfig[canonicalId]
      if (rawValue !== undefined) config[field.id] = String(rawValue ?? '')
    }
    return config
  })

  const {
    sourceConfig,
    canonicalModes,
    canonicalGroups,
    isFieldVisible,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  } = useConnectorConfigFields({ connectorConfig, initialSourceConfig })

  const { mutate: updateConnector, isPending: isSaving } = useUpdateConnector()

  const { data: subscriptionResponse } = useSubscriptionData({ enabled: isBillingEnabled })
  const subscriptionAccess = getSubscriptionAccessState(subscriptionResponse?.data)
  const hasMaxAccess = !isBillingEnabled || subscriptionAccess.hasUsableMaxAccess

  const hasChanges = useMemo(() => {
    if (syncInterval !== connector.syncIntervalMinutes) return true
    const resolved = resolveSourceConfig()
    for (const [key, value] of Object.entries(resolved)) {
      if (String(connector.sourceConfig[key] ?? '') !== value) return true
    }
    return false
  }, [resolveSourceConfig, syncInterval, connector.syncIntervalMinutes, connector.sourceConfig])

  const handleSave = () => {
    setError(null)

    const updates: { sourceConfig?: Record<string, unknown>; syncIntervalMinutes?: number } = {}

    if (syncInterval !== connector.syncIntervalMinutes) {
      updates.syncIntervalMinutes = syncInterval
    }

    const resolved = resolveSourceConfig()
    const changedEntries: Record<string, string> = {}
    for (const [key, value] of Object.entries(resolved)) {
      if (String(connector.sourceConfig[key] ?? '') !== value) changedEntries[key] = value
    }
    if (Object.keys(changedEntries).length > 0) {
      updates.sourceConfig = { ...connector.sourceConfig, ...changedEntries }
    }

    if (Object.keys(updates).length === 0) {
      onOpenChange(false)
      return
    }

    updateConnector(
      { knowledgeBaseId, connectorId: connector.id, updates },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
        onError: (err) => {
          logger.error('Failed to update connector', { error: err.message })
          setError(err.message)
        },
      }
    )
  }

  const displayName = connectorConfig?.name ?? connector.connectorType
  const Icon = connectorConfig?.icon

  return (
    <Modal open={open} onOpenChange={(val) => !isSaving && onOpenChange(val)}>
      <ModalContent size='md'>
        <ModalHeader>
          <div className='flex items-center gap-2'>
            {Icon && <Icon className='h-5 w-5' />}
            Edit {displayName}
          </div>
        </ModalHeader>

        <ModalTabs value={activeTab} onValueChange={setActiveTab}>
          <ModalTabsList>
            <ModalTabsTrigger value='settings'>Settings</ModalTabsTrigger>
            <ModalTabsTrigger value='documents'>Documents</ModalTabsTrigger>
          </ModalTabsList>

          <ModalBody>
            <ModalTabsContent value='settings'>
              <SettingsTab
                connectorConfig={connectorConfig}
                sourceConfig={sourceConfig}
                credentialId={connector.credentialId}
                canonicalGroups={canonicalGroups}
                canonicalModes={canonicalModes}
                onToggleCanonicalMode={toggleCanonicalMode}
                onFieldChange={handleFieldChange}
                isFieldVisible={isFieldVisible}
                syncInterval={syncInterval}
                setSyncInterval={setSyncInterval}
                hasMaxAccess={hasMaxAccess}
                isSaving={isSaving}
                error={error}
              />
            </ModalTabsContent>

            <ModalTabsContent value='documents'>
              <DocumentsTab knowledgeBaseId={knowledgeBaseId} connectorId={connector.id} />
            </ModalTabsContent>
          </ModalBody>
        </ModalTabs>

        {activeTab === 'settings' && (
          <ModalFooter>
            <Button variant='default' onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant='primary' onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  )
}

interface SettingsTabProps {
  connectorConfig: ConnectorConfig | null
  sourceConfig: Record<string, string>
  credentialId: string | null
  canonicalGroups: Map<string, ConnectorConfigField[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  onToggleCanonicalMode: (canonicalId: string) => void
  onFieldChange: (fieldId: string, value: string) => void
  isFieldVisible: (field: ConnectorConfigField) => boolean
  syncInterval: number
  setSyncInterval: (v: number) => void
  hasMaxAccess: boolean
  isSaving: boolean
  error: string | null
}

function SettingsTab({
  connectorConfig,
  sourceConfig,
  credentialId,
  canonicalGroups,
  canonicalModes,
  onToggleCanonicalMode,
  onFieldChange,
  isFieldVisible,
  syncInterval,
  setSyncInterval,
  hasMaxAccess,
  isSaving,
  error,
}: SettingsTabProps) {
  return (
    <div className='flex flex-col gap-3'>
      {connectorConfig?.configFields.map((field) => {
        if (!isFieldVisible(field)) return null

        const canonicalId = field.canonicalParamId
        const hasCanonicalPair =
          canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2

        return (
          <div key={field.id} className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <Label>
                {field.title}
                {field.required && <span className='ml-0.5 text-[var(--text-error)]'>*</span>}
              </Label>
              {hasCanonicalPair && canonicalId && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      className='flex h-[18px] w-[18px] items-center justify-center rounded-[3px] text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-secondary)]'
                      onClick={() => onToggleCanonicalMode(canonicalId)}
                    >
                      <ArrowLeftRight className='h-[12px] w-[12px]' />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {field.mode === 'basic' ? 'Switch to manual input' : 'Switch to selector'}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            </div>
            {field.description && (
              <p className='text-[var(--text-muted)] text-xs'>{field.description}</p>
            )}
            {field.type === 'selector' && field.selectorKey ? (
              <ConnectorSelectorField
                field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                value={sourceConfig[field.id] || ''}
                onChange={(value) => onFieldChange(field.id, value)}
                credentialId={credentialId}
                sourceConfig={sourceConfig}
                configFields={connectorConfig.configFields}
                canonicalModes={canonicalModes}
                disabled={isSaving}
              />
            ) : field.type === 'dropdown' && field.options ? (
              <Combobox
                size='sm'
                options={field.options.map((opt) => ({
                  label: opt.label,
                  value: opt.id,
                }))}
                value={sourceConfig[field.id] || undefined}
                onChange={(value) => onFieldChange(field.id, value)}
                placeholder={field.placeholder || `Select ${field.title.toLowerCase()}`}
              />
            ) : (
              <Input
                value={sourceConfig[field.id] || ''}
                onChange={(e) => onFieldChange(field.id, e.target.value)}
                placeholder={field.placeholder}
              />
            )}
          </div>
        )
      })}

      <div className='flex flex-col gap-2'>
        <Label>Sync Frequency</Label>
        <ButtonGroup
          value={String(syncInterval)}
          onValueChange={(val) => setSyncInterval(Number(val))}
        >
          {SYNC_INTERVALS.map((interval) => (
            <ButtonGroupItem
              key={interval.value}
              value={String(interval.value)}
              disabled={interval.requiresMax && !hasMaxAccess}
            >
              {interval.label}
              {interval.requiresMax && !hasMaxAccess && <MaxBadge />}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {error && <p className='text-[var(--text-error)] text-caption leading-tight'>{error}</p>}
    </div>
  )
}

interface DocumentsTabProps {
  knowledgeBaseId: string
  connectorId: string
}

function DocumentsTab({ knowledgeBaseId, connectorId }: DocumentsTabProps) {
  const [filter, setFilter] = useState<'active' | 'excluded'>('active')

  const { data, isLoading } = useConnectorDocuments(knowledgeBaseId, connectorId, {
    includeExcluded: true,
  })

  const { mutate: excludeDoc, isPending: isExcluding } = useExcludeConnectorDocument()
  const { mutate: restoreDoc, isPending: isRestoring } = useRestoreConnectorDocument()

  const documents = useMemo(() => {
    if (!data?.documents) return []
    return data.documents.filter((d) => (filter === 'excluded' ? d.userExcluded : !d.userExcluded))
  }, [data?.documents, filter])

  const counts = data?.counts ?? { active: 0, excluded: 0 }

  if (isLoading) {
    return (
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <ButtonGroup value={filter} onValueChange={(val) => setFilter(val as 'active' | 'excluded')}>
        <ButtonGroupItem value='active'>Active ({counts.active})</ButtonGroupItem>
        <ButtonGroupItem value='excluded'>Excluded ({counts.excluded})</ButtonGroupItem>
      </ButtonGroup>

      <div className='max-h-[320px] min-h-0 overflow-y-auto'>
        {documents.length === 0 ? (
          <p className='py-4 text-center text-[var(--text-muted)] text-small'>
            {filter === 'excluded' ? 'No excluded documents' : 'No documents yet'}
          </p>
        ) : (
          <div className='flex flex-col gap-2'>
            {documents.map((doc) => (
              <div key={doc.id} className='flex items-center justify-between'>
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span className='truncate text-[var(--text-primary)] text-small'>
                    {doc.filename}
                  </span>
                  {doc.sourceUrl && (
                    <a
                      href={doc.sourceUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='flex-shrink-0 text-[var(--text-muted)] hover-hover:text-[var(--text-secondary)]'
                    >
                      <ExternalLink className='h-3 w-3' />
                    </a>
                  )}
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  className='flex-shrink-0'
                  disabled={doc.userExcluded ? isRestoring : isExcluding}
                  onClick={() =>
                    doc.userExcluded
                      ? restoreDoc({ knowledgeBaseId, connectorId, documentIds: [doc.id] })
                      : excludeDoc({ knowledgeBaseId, connectorId, documentIds: [doc.id] })
                  }
                >
                  {doc.userExcluded ? (
                    <>
                      <RotateCcw className='mr-1 h-3 w-3' />
                      Restore
                    </>
                  ) : (
                    'Exclude'
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
