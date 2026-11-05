import { useState } from 'react'
import { SourceEditor } from '@/platform/app/(shell)/integrations/_components/search-settings/source-editor'
import { ActionMenu, Button, Modal, Select, Switch } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import type {
  IntegrationProvider,
  IntegrationSource,
  OrganizationIntegration,
  SearchMode,
} from '@/platform/lib/integrations/model'

const MODE_LABELS: Record<SearchMode, string> = {
  member: 'Member accounts',
  service_account: 'Service account',
}

interface SearchSettingsProps {
  provider: IntegrationProvider
  integration: OrganizationIntegration
  canManage: boolean
  onChange: (next: OrganizationIntegration) => void
}

type SourceAction =
  | { kind: 'edit' | 'remove'; source: IntegrationSource }
  | { kind: 'add' | 'disable' }

export function SearchSettings({
  provider,
  integration,
  canManage,
  onChange,
}: SearchSettingsProps) {
  const [action, setAction] = useState<SourceAction | null>(null)
  const mode = integration.searchMode ?? provider.searchModes[0]
  if (!mode) return null
  const sources = integration.sources.filter((source) => source.mode === 'service_account')
  const eligible = sources.filter((source) => source.enabled && source.available && !source.draft)
  const perSource = provider.id === 'github' || provider.id === 'gitlab'
  const ready =
    mode === 'member' ||
    (perSource
      ? eligible.length > 0
      : eligible.some((source) => source.id === integration.sourceId))

  function saveSource(source: IntegrationSource) {
    const exists = integration.sources.some((item) => item.id === source.id)
    onChange({
      ...integration,
      sources: exists
        ? integration.sources.map((item) => (item.id === source.id ? source : item))
        : [...integration.sources, source],
    })
  }

  return (
    <>
      <SettingsSection title='Organization search'>
        <SettingsRow
          label='Allow in Search'
          description={
            integration.searchApproved
              ? !canManage && mode === 'service_account'
                ? 'Your organization has approved this integration for search.'
                : ready
                  ? `Members can search ${provider.name} through Sim.`
                  : 'Search is approved and waiting for an active source.'
              : `${provider.name} is unavailable in Search.`
          }
        >
          {canManage ? (
            <Switch
              label='Allow in Search'
              checked={integration.searchApproved}
              onCheckedChange={(approved) =>
                approved
                  ? onChange({ ...integration, searchApproved: true, searchMode: mode })
                  : setAction({ kind: 'disable' })
              }
            />
          ) : (
            <span data-type='T060'>{integration.searchApproved ? 'Enabled' : 'Off'}</span>
          )}
        </SettingsRow>
        {(canManage || integration.searchApproved) && (
          <SettingsRow
            field
            label='Search access'
            description={
              mode === 'member'
                ? 'Each person searches content their provider account can access.'
                : provider.id === 'gitlab'
                  ? 'A service account checks project access for each member.'
                  : 'Results must be accessible to both the member and the configured source.'
            }
          >
            {canManage && provider.searchModes.length > 1 ? (
              <Select
                label='Search access'
                value={mode}
                options={provider.searchModes.map((value) => ({
                  value,
                  label: MODE_LABELS[value],
                }))}
                onValueChange={(value) => {
                  const next = provider.searchModes.find((entry) => entry === value)
                  if (next && next !== mode)
                    onChange({ ...integration, searchMode: next, sourceId: null })
                }}
              />
            ) : (
              <span data-type='T060'>{MODE_LABELS[mode]}</span>
            )}
          </SettingsRow>
        )}
      </SettingsSection>
      {canManage && mode === 'service_account' && (
        <SettingsSection title='Search sources'>
          {!perSource && (
            <SettingsRow
              field
              label='Active source'
              description={
                eligible.length
                  ? 'Choose the source used for organization search.'
                  : 'Authorize a source before selecting it for search.'
              }
            >
              {eligible.length ? (
                <Select
                  label='Active source'
                  value={integration.sourceId ?? ''}
                  options={[
                    { value: '', label: 'Select a source' },
                    ...eligible.map(({ id, label }) => ({ value: id, label })),
                  ]}
                  onValueChange={(value) => onChange({ ...integration, sourceId: value || null })}
                />
              ) : (
                <span data-type='T060'>None available</span>
              )}
            </SettingsRow>
          )}
          {sources.map((source) => (
            <SettingsRow
              label={source.label}
              key={source.id}
              description={
                source.draft
                  ? 'Awaiting authorization'
                  : !source.available
                    ? 'Unavailable'
                    : source.enabled
                      ? 'Active'
                      : 'Paused'
              }
            >
              <ActionMenu
                label={`Manage ${source.label}`}
                icon='I108'
                triggerSize='compact'
                tooltip={false}
                actions={[
                  {
                    id: 'edit',
                    label: source.draft ? 'Edit draft' : 'Source settings',
                    onSelect: () => setAction({ kind: 'edit', source }),
                  },
                  ...(!source.draft && source.available
                    ? [
                        {
                          id: 'enabled',
                          label: source.enabled ? 'Pause source' : 'Resume source',
                          onSelect: () =>
                            onChange({
                              ...integration,
                              sourceId:
                                integration.sourceId === source.id && source.enabled
                                  ? null
                                  : integration.sourceId,
                              sources: integration.sources.map((entry) =>
                                entry.id === source.id
                                  ? { ...entry, enabled: !entry.enabled }
                                  : entry
                              ),
                            }),
                        },
                      ]
                    : []),
                  {
                    id: 'remove',
                    label: source.draft ? 'Discard draft' : 'Remove source',
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => setAction({ kind: 'remove', source }),
                  },
                ]}
              />
            </SettingsRow>
          ))}
          <SettingsRow
            label='Add a source'
            description={
              perSource
                ? 'Each configured project or repository has its own source.'
                : 'Define the content this service account can search.'
            }
          >
            <Button size='compact' onClick={() => setAction({ kind: 'add' })}>
              Add source
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      {action?.kind === 'disable' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title='Disable organization search?'
          description={`Members will no longer be able to search ${provider.name} through Sim.`}
          confirmLabel='Disable search'
          variant='confirm'
          destructive
          onConfirm={() => onChange({ ...integration, searchApproved: false })}
        />
      )}
      {(action?.kind === 'edit' || action?.kind === 'add') && (
        <SourceEditor
          provider={provider}
          source={action.kind === 'edit' ? action.source : undefined}
          onClose={() => setAction(null)}
          onSave={saveSource}
        />
      )}
      {action?.kind === 'remove' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title={action.source.draft ? 'Discard source draft?' : 'Remove search source?'}
          description={action.source.label}
          confirmLabel={action.source.draft ? 'Discard draft' : 'Remove source'}
          variant='confirm'
          destructive
          onConfirm={() =>
            onChange({
              ...integration,
              sourceId: integration.sourceId === action.source.id ? null : integration.sourceId,
              sources: integration.sources.filter((source) => source.id !== action.source.id),
            })
          }
        />
      )}
    </>
  )
}
