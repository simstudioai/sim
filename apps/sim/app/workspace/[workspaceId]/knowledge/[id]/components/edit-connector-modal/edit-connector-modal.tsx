'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ExternalLink, Loader2, RotateCcw } from 'lucide-react'
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
} from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfig } from '@/connectors/types'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'
import {
  useConnectorDocuments,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
  useUpdateConnector,
} from '@/hooks/queries/kb/connectors'

const logger = createLogger('EditConnectorModal')

const SYNC_INTERVALS = [
  { label: 'Every hour', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Daily', value: 1440 },
  { label: 'Weekly', value: 10080 },
  { label: 'Manual only', value: 0 },
] as const

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

  const initialSourceConfig = useMemo(() => {
    const config: Record<string, string> = {}
    for (const [key, value] of Object.entries(connector.sourceConfig)) {
      if (!INTERNAL_CONFIG_KEYS.has(key)) {
        config[key] = String(value ?? '')
      }
    }
    return config
  }, [connector.sourceConfig])

  const [activeTab, setActiveTab] = useState('settings')
  const [sourceConfig, setSourceConfig] = useState<Record<string, string>>(initialSourceConfig)
  const [syncInterval, setSyncInterval] = useState(connector.syncIntervalMinutes)
  const [error, setError] = useState<string | null>(null)

  const { mutate: updateConnector, isPending: isSaving } = useUpdateConnector()

  const hasChanges = useMemo(() => {
    if (syncInterval !== connector.syncIntervalMinutes) return true
    for (const [key, value] of Object.entries(sourceConfig)) {
      if (String(connector.sourceConfig[key] ?? '') !== value) return true
    }
    return false
  }, [sourceConfig, syncInterval, connector.syncIntervalMinutes, connector.sourceConfig])

  const handleSave = () => {
    setError(null)

    const updates: { sourceConfig?: Record<string, unknown>; syncIntervalMinutes?: number } = {}

    if (syncInterval !== connector.syncIntervalMinutes) {
      updates.syncIntervalMinutes = syncInterval
    }

    const configChanged = Object.entries(sourceConfig).some(
      ([key, value]) => String(connector.sourceConfig[key] ?? '') !== value
    )
    if (configChanged) {
      updates.sourceConfig = { ...connector.sourceConfig, ...sourceConfig }
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
                setSourceConfig={setSourceConfig}
                syncInterval={syncInterval}
                setSyncInterval={setSyncInterval}
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
            <Button variant='tertiary' onClick={handleSave} disabled={!hasChanges || isSaving}>
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
  setSourceConfig: React.Dispatch<React.SetStateAction<Record<string, string>>>
  syncInterval: number
  setSyncInterval: (v: number) => void
  error: string | null
}

function SettingsTab({
  connectorConfig,
  sourceConfig,
  setSourceConfig,
  syncInterval,
  setSyncInterval,
  error,
}: SettingsTabProps) {
  return (
    <div className='flex flex-col gap-[12px]'>
      {connectorConfig?.configFields.map((field) => (
        <div key={field.id} className='flex flex-col gap-[4px]'>
          <Label>
            {field.title}
            {field.required && <span className='ml-[2px] text-[var(--text-error)]'>*</span>}
          </Label>
          {field.description && (
            <p className='text-[11px] text-[var(--text-muted)]'>{field.description}</p>
          )}
          {field.type === 'dropdown' && field.options ? (
            <Combobox
              size='sm'
              options={field.options.map((opt) => ({
                label: opt.label,
                value: opt.id,
              }))}
              value={sourceConfig[field.id] || undefined}
              onChange={(value) => setSourceConfig((prev) => ({ ...prev, [field.id]: value }))}
              placeholder={field.placeholder || `Select ${field.title.toLowerCase()}`}
            />
          ) : (
            <Input
              value={sourceConfig[field.id] || ''}
              onChange={(e) => setSourceConfig((prev) => ({ ...prev, [field.id]: e.target.value }))}
              placeholder={field.placeholder}
            />
          )}
        </div>
      ))}

      <div className='flex flex-col gap-[4px]'>
        <Label>Sync Frequency</Label>
        <ButtonGroup
          value={String(syncInterval)}
          onValueChange={(val) => setSyncInterval(Number(val))}
        >
          {SYNC_INTERVALS.map((interval) => (
            <ButtonGroupItem key={interval.value} value={String(interval.value)}>
              {interval.label}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {error && <p className='text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>}
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
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-[16px]'>
      <ButtonGroup value={filter} onValueChange={(val) => setFilter(val as 'active' | 'excluded')}>
        <ButtonGroupItem value='active'>Active ({counts.active})</ButtonGroupItem>
        <ButtonGroupItem value='excluded'>Excluded ({counts.excluded})</ButtonGroupItem>
      </ButtonGroup>

      <div className='max-h-[320px] min-h-0 overflow-y-auto'>
        {documents.length === 0 ? (
          <p className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
            {filter === 'excluded' ? 'No excluded documents' : 'No documents yet'}
          </p>
        ) : (
          <div className='flex flex-col gap-[8px]'>
            {documents.map((doc) => (
              <div key={doc.id} className='flex items-center justify-between'>
                <div className='flex min-w-0 items-center gap-[6px]'>
                  <span className='truncate text-[13px] text-[var(--text-primary)]'>
                    {doc.filename}
                  </span>
                  {doc.sourceUrl && (
                    <a
                      href={doc.sourceUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
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
