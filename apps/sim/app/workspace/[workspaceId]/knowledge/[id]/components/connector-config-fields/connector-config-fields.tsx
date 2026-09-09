'use client'

import { Button, ChipCombobox, ChipInput, ChipModalField, Tooltip } from '@sim/emcn'
import { ArrowLeftRight, CircleInfo } from '@sim/emcn/icons'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { SourceSelectionLabel, SourceSelectionLabels } from '@/lib/sim-search/source-identity'
import { isConnectorFieldRequired } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'

export interface ConnectorConfigFieldsProps {
  scope?: ResourceScope
  accessMode?: ConnectorAccessMode
  /** Registry definition whose `configFields` drive the rendered rows. */
  connectorConfig: ConnectorMeta
  /** Current values keyed by field ID. */
  sourceConfig: ConfigFieldMap
  selectionLabels?: SourceSelectionLabels
  /** OAuth credential backing selector fields, when available. */
  credentialId: string | null
  /** Canonical-pair groups keyed by `canonicalParamId`. */
  canonicalGroups: Map<string, ConnectorConfigField[]>
  /** Active mode per canonical pair. */
  canonicalModes: Record<string, 'basic' | 'advanced'>
  /** Visibility predicate honoring `condition` / canonical mode. */
  isFieldVisible: (field: ConnectorConfigField) => boolean
  /** Field value change handler. */
  onFieldChange: (
    fieldId: string,
    value: ConfigFieldValue,
    selectedOptions?: SourceSelectionLabel[]
  ) => void
  /** Swaps a canonical pair between selector and manual input. */
  onToggleCanonicalMode: (canonicalId: string) => void
  /** Disables configuration fields during submission. */
  disabled: boolean
}

/**
 * Renders the connector's dynamic configuration fields as canonical
 * `ChipModalField` rows. Shared by the add- and edit-connector modals so the
 * label + info tooltip + canonical-pair toggle + selector/dropdown/input
 * switch stays identical in both flows.
 */
export function ConnectorConfigFields({
  scope,
  accessMode = 'workspace',
  connectorConfig,
  sourceConfig,
  selectionLabels,
  credentialId,
  canonicalGroups,
  canonicalModes,
  isFieldVisible,
  onFieldChange,
  onToggleCanonicalMode,
  disabled,
}: ConnectorConfigFieldsProps) {
  return (
    <>
      {connectorConfig.configFields.map((field) => {
        if (!isFieldVisible(field)) return null

        const canonicalId = field.canonicalParamId
        const hasCanonicalPair =
          canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2

        return (
          <ChipModalField
            key={field.id}
            type='custom'
            title={
              /**
               * Buttons inside the field's `Label` would become its labeled
               * control, so a click on the title text would forward to them.
               * Cancelling the click's default action keeps label clicks
               * inert without affecting the buttons' own handlers.
               */
              <span
                className='flex w-full items-center justify-between'
                onClick={(event) => event.preventDefault()}
              >
                <span className='flex items-center gap-1'>
                  <span>
                    {field.title}
                    {isConnectorFieldRequired(field, connectorConfig, accessMode) && (
                      <span className='ml-0.5'>*</span>
                    )}
                  </span>
                  {field.description && (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          aria-label={`About ${field.title}`}
                        >
                          <CircleInfo className='size-[14px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top'>{field.description}</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </span>
                {hasCanonicalPair && canonicalId && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        type='button'
                        variant='quiet'
                        size='icon'
                        disabled={disabled}
                        aria-label={`Switch ${field.title} to ${field.mode === 'basic' ? 'manual input' : 'selector'}`}
                        onClick={() => onToggleCanonicalMode(canonicalId)}
                      >
                        <ArrowLeftRight className='size-[14px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>
                      {field.mode === 'basic' ? 'Switch to manual input' : 'Switch to selector'}
                    </Tooltip.Content>
                  </Tooltip.Root>
                )}
              </span>
            }
          >
            {field.type === 'selector' && field.selectorKey ? (
              <ConnectorSelectorField
                scope={scope}
                field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                value={sourceConfig[field.id] ?? (field.multi ? [] : '')}
                onChange={(value, selectedOptions) =>
                  onFieldChange(field.id, value, selectedOptions)
                }
                selectedLabels={selectionLabels?.[field.canonicalParamId ?? field.id]}
                credentialId={credentialId}
                sourceConfig={sourceConfig}
                configFields={connectorConfig.configFields}
                canonicalModes={canonicalModes}
                disabled={disabled}
              />
            ) : field.type === 'dropdown' && field.options ? (
              <ChipCombobox
                disabled={disabled}
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
              <ChipInput
                disabled={disabled}
                value={
                  Array.isArray(sourceConfig[field.id])
                    ? (sourceConfig[field.id] as string[]).join(', ')
                    : (sourceConfig[field.id] as string) || ''
                }
                onChange={(e) => onFieldChange(field.id, e.target.value)}
                placeholder={field.placeholder}
              />
            )}
          </ChipModalField>
        )
      })}
    </>
  )
}
