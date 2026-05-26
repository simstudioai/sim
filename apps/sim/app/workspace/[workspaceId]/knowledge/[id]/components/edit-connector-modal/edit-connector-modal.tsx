'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeftRight, ExternalLink, Info, RotateCcw } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Combobox,
  Input,
  Label,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
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
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
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

/** Keys injected by the sync engine or modal state — not user-editable */
const INTERNAL_CONFIG_KEYS = new Set(['tagSlotMapping', 'disabledTagIds', '_canonicalModes'])

const CANONICAL_MODES_KEY = '_canonicalModes'

function readPersistedCanonicalModes(
  sourceConfig: Record<string, unknown>
): Record<string, 'basic' | 'advanced'> {
  const raw = sourceConfig[CANONICAL_MODES_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, 'basic' | 'advanced'> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'basic' || value === 'advanced') result[key] = value
  }
  return result
}

/**
 * Deep equality for sourceConfig values (string, string[], or undefined/null).
 *
 * Empty string, empty array, and nullish are treated as equivalent to absence.
 * When either side is an array (multi-value field), both sides are normalized
 * to string[] via CSV-split-and-trim so a persisted legacy scalar `"ENG"`
 * compares equal to an in-memory `["ENG"]` and a persisted CSV `"ENG,PROJ"`
 * compares equal to `["ENG","PROJ"]`. Without this, opening edit on a
 * pre-multi-select connector would falsely show unsaved changes.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  const isEmpty = (v: unknown): boolean => {
    if (v == null) return true
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'string') return v.trim() === ''
    return false
  }
  if (isEmpty(a) && isEmpty(b)) return true

  const toArray = (v: unknown): string[] | null => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
    if (typeof v === 'string') {
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return null
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = toArray(a) ?? []
    const arrB = toArray(b) ?? []
    if (arrA.length !== arrB.length) return false
    /**
     * Order-insensitive: the multi-select UI does not guarantee insertion order
     * matches the server-returned order, so `["PROD","ENG"]` and `["ENG","PROD"]`
     * should be treated as equal to avoid a false unsaved-changes state.
     */
    const setA = new Set(arrA)
    return arrB.every((v) => setA.has(v))
  }
  return a === b
}

function didCanonicalModesChange(
  current: Record<string, 'basic' | 'advanced'>,
  persisted: Record<string, 'basic' | 'advanced'>
): boolean {
  const keys = new Set([...Object.keys(persisted), ...Object.keys(current)])
  for (const key of keys) {
    if ((current[key] ?? 'basic') !== (persisted[key] ?? 'basic')) return true
  }
  return false
}

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
  const [initialSourceConfig] = useState<ConfigFieldMap>(() => {
    const config: ConfigFieldMap = {}
    if (!connectorConfig) {
      for (const [key, value] of Object.entries(connector.sourceConfig)) {
        if (INTERNAL_CONFIG_KEYS.has(key)) continue
        if (Array.isArray(value)) {
          config[key] = value.filter((v): v is string => typeof v === 'string')
        } else {
          config[key] = String(value ?? '')
        }
      }
      return config
    }
    for (const field of connectorConfig.configFields) {
      const canonicalId = field.canonicalParamId ?? field.id
      if (INTERNAL_CONFIG_KEYS.has(canonicalId)) continue
      const rawValue = connector.sourceConfig[canonicalId]
      if (rawValue === undefined) continue
      if (field.multi) {
        if (Array.isArray(rawValue)) {
          config[field.id] = rawValue.filter((v): v is string => typeof v === 'string')
        } else if (typeof rawValue === 'string') {
          config[field.id] = rawValue
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        } else {
          config[field.id] = []
        }
      } else {
        config[field.id] = String(rawValue ?? '')
      }
    }
    return config
  })

  const [initialCanonicalModes] = useState<Record<string, 'basic' | 'advanced'>>(() =>
    readPersistedCanonicalModes(connector.sourceConfig)
  )

  const {
    sourceConfig,
    canonicalModes,
    canonicalGroups,
    isFieldVisible,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  } = useConnectorConfigFields({
    connectorConfig,
    initialSourceConfig,
    initialCanonicalModes,
  })

  const { mutate: updateConnector, isPending: isSaving } = useUpdateConnector()

  const { data: subscriptionResponse } = useSubscriptionData({ enabled: isBillingEnabled })
  const subscriptionAccess = getSubscriptionAccessState(subscriptionResponse?.data)
  const hasMaxAccess = !isBillingEnabled || subscriptionAccess.hasUsableMaxAccess

  const persistedCanonicalModes = useMemo(
    () => readPersistedCanonicalModes(connector.sourceConfig),
    [connector.sourceConfig]
  )

  const hasChanges = useMemo(() => {
    if (syncInterval !== connector.syncIntervalMinutes) return true
    if (didCanonicalModesChange(canonicalModes, persistedCanonicalModes)) return true
    const resolved = resolveSourceConfig()
    for (const [key, value] of Object.entries(resolved)) {
      if (!valuesEqual(connector.sourceConfig[key], value)) return true
    }
    return false
  }, [
    resolveSourceConfig,
    syncInterval,
    connector.syncIntervalMinutes,
    connector.sourceConfig,
    canonicalModes,
    persistedCanonicalModes,
  ])

  const handleSave = () => {
    setError(null)

    const updates: { sourceConfig?: Record<string, unknown>; syncIntervalMinutes?: number } = {}

    if (syncInterval !== connector.syncIntervalMinutes) {
      updates.syncIntervalMinutes = syncInterval
    }

    const resolved = resolveSourceConfig()
    const changedEntries: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolved)) {
      if (!valuesEqual(connector.sourceConfig[key], value)) changedEntries[key] = value
    }

    const modesChanged = didCanonicalModesChange(canonicalModes, persistedCanonicalModes)

    if (Object.keys(changedEntries).length > 0 || modesChanged) {
      const next: Record<string, unknown> = { ...connector.sourceConfig, ...changedEntries }
      if (Object.keys(canonicalModes).length > 0) {
        next[CANONICAL_MODES_KEY] = canonicalModes
      } else {
        delete next[CANONICAL_MODES_KEY]
      }
      updates.sourceConfig = next
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
            {Icon && <Icon className='size-5' />}
            Edit {displayName}
          </div>
        </ModalHeader>
        <ModalDescription className='sr-only'>
          Configure settings and manage documents for this connector
        </ModalDescription>

        <ModalTabs value={activeTab} onValueChange={setActiveTab}>
          <ModalTabsList>
            <ModalTabsTrigger value='settings'>Settings</ModalTabsTrigger>
            <ModalTabsTrigger value='documents'>Documents</ModalTabsTrigger>
          </ModalTabsList>

          <ModalBody className='pb-3'>
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
                  <Loader className='mr-1.5 size-3.5' animate />
                  Saving…
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
  sourceConfig: ConfigFieldMap
  credentialId: string | null
  canonicalGroups: Map<string, ConnectorConfigField[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  onToggleCanonicalMode: (canonicalId: string) => void
  onFieldChange: (fieldId: string, value: ConfigFieldValue) => void
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
              <div className='flex items-center gap-1'>
                <Label>
                  {field.title}
                  {field.required && <span className='ml-0.5'>*</span>}
                </Label>
                {field.description && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        type='button'
                        variant='ghost'
                        className='flex size-[14px] cursor-help items-center justify-center p-0 text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-secondary)]'
                        aria-label={`About ${field.title}`}
                      >
                        <Info className='size-[12px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>{field.description}</Tooltip.Content>
                  </Tooltip.Root>
                )}
              </div>
              {hasCanonicalPair && canonicalId && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      className='flex size-[18px] items-center justify-center rounded-[3px] p-0 text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-secondary)]'
                      onClick={() => onToggleCanonicalMode(canonicalId)}
                    >
                      <ArrowLeftRight className='size-[12px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {field.mode === 'basic' ? 'Switch to manual input' : 'Switch to selector'}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            </div>
            {field.type === 'selector' && field.selectorKey ? (
              <ConnectorSelectorField
                field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                value={sourceConfig[field.id] ?? (field.multi ? [] : '')}
                onChange={(value: ConfigFieldValue) => onFieldChange(field.id, value)}
                credentialId={credentialId}
                sourceConfig={sourceConfig}
                configFields={connectorConfig.configFields}
                canonicalModes={canonicalModes}
                disabled={isSaving}
              />
            ) : field.type === 'dropdown' && field.options ? (
              <Combobox
                options={field.options.map((opt) => ({
                  label: opt.label,
                  value: opt.id,
                }))}
                value={
                  typeof sourceConfig[field.id] === 'string'
                    ? (sourceConfig[field.id] as string) || undefined
                    : undefined
                }
                onChange={(value) => onFieldChange(field.id, value)}
                placeholder={field.placeholder || `Select ${field.title.toLowerCase()}`}
              />
            ) : (
              <Input
                value={
                  Array.isArray(sourceConfig[field.id])
                    ? (sourceConfig[field.id] as string[]).join(', ')
                    : (sourceConfig[field.id] as string) || ''
                }
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
        <Skeleton className='h-7 w-[180px] rounded-md' />
        <Skeleton className='h-9 w-full rounded-lg' />
        <Skeleton className='h-9 w-full rounded-lg' />
        <Skeleton className='h-9 w-full rounded-lg' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <ButtonGroup value={filter} onValueChange={(val) => setFilter(val as 'active' | 'excluded')}>
        <ButtonGroupItem value='active'>Active ({counts.active})</ButtonGroupItem>
        <ButtonGroupItem value='excluded'>Excluded ({counts.excluded})</ButtonGroupItem>
      </ButtonGroup>

      <div className='max-h-[320px] min-h-0 overflow-y-auto [scrollbar-gutter:stable]'>
        {documents.length === 0 ? (
          <p className='rounded-lg bg-[var(--surface-3)] px-3 py-8 text-center text-[var(--text-muted)] text-small'>
            {filter === 'excluded' ? 'No excluded documents' : 'No documents yet'}
          </p>
        ) : (
          <div className='flex flex-col gap-0.5 pr-1'>
            {documents.map((doc) => (
              <div
                key={doc.id}
                className='flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover-hover:bg-[var(--surface-active)]'
              >
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span className='truncate text-[var(--text-primary)] text-small'>
                    {doc.filename}
                  </span>
                  {doc.sourceUrl && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <a
                          href={doc.sourceUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='flex size-5 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
                        >
                          <ExternalLink className='size-3' />
                        </a>
                      </Tooltip.Trigger>
                      <Tooltip.Content>Open source document</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </div>
                <Button
                  variant='ghost-secondary'
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
                      <RotateCcw className='mr-1 size-3' />
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
