'use client'

import { Button, ChipCombobox, ChipInput, ChipModalField, IconSwitch, Tooltip } from '@sim/emcn'
import { CircleInfo, List, TypeText } from '@sim/emcn/icons'
import type { SelectorKey } from '@/lib/selectors/manifest'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'

const MODE_OPTIONS = [
  { value: 'basic', label: 'Selector', icon: List },
  { value: 'advanced', label: 'Manual input', icon: TypeText },
] as const

export interface ConnectorConfigFieldsProps {
  /** Registry definition whose `configFields` drive the rendered rows. */
  connectorConfig: ConnectorMeta
  /** Current values keyed by field ID. */
  sourceConfig: ConfigFieldMap
  /** OAuth credential backing selector fields, when available. */
  credentialId: string | null
  /** Canonical-pair groups keyed by `canonicalParamId`. */
  canonicalGroups: Map<string, ConnectorConfigField[]>
  /** Active mode per canonical pair. */
  canonicalModes: Record<string, 'basic' | 'advanced'>
  /** Visibility predicate honoring `condition` / canonical mode. */
  isFieldVisible: (field: ConnectorConfigField) => boolean
  /** Field value change handler. */
  onFieldChange: (fieldId: string, value: ConfigFieldValue) => void
  /** Swaps a canonical pair between selector and manual input. */
  onToggleCanonicalMode: (canonicalId: string) => void
  /** Disables selector fields during submission. */
  disabled: boolean
}

/**
 * Renders the connector's dynamic configuration fields as canonical
 * `ChipModalField` rows. Shared by the add- and edit-connector modals so the
 * label + info tooltip + canonical-pair toggle + selector/dropdown/input
 * switch stays identical in both flows.
 */
export function ConnectorConfigFields({
  connectorConfig,
  sourceConfig,
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
              <span className='flex items-center gap-1' onClick={(event) => event.preventDefault()}>
                <span>
                  {field.title}
                  {field.required && <span className='ml-0.5'>*</span>}
                </span>
                {field.description && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        type='button'
                        variant='ghost'
                        className='flex size-[14px] cursor-help items-center justify-center p-0 text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-secondary)]'
                        aria-label={`About ${field.title}`}
                      >
                        <CircleInfo className='size-[12px]' />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>{field.description}</Tooltip.Content>
                  </Tooltip.Root>
                )}
              </span>
            }
            titleAdornment={
              hasCanonicalPair && canonicalId ? (
                <IconSwitch
                  options={MODE_OPTIONS}
                  value={field.mode === 'advanced' ? 'advanced' : 'basic'}
                  onValueChange={() => onToggleCanonicalMode(canonicalId)}
                  disabled={disabled}
                  showTooltips
                  aria-label={`${field.title} input mode`}
                  className='-my-1'
                />
              ) : undefined
            }
          >
            {field.type === 'selector' && field.selectorKey ? (
              <ConnectorSelectorField
                field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                value={sourceConfig[field.id] ?? (field.multi ? [] : '')}
                onChange={(value: ConfigFieldValue) => onFieldChange(field.id, value)}
                credentialId={credentialId}
                sourceConfig={sourceConfig}
                configFields={connectorConfig.configFields}
                canonicalModes={canonicalModes}
                disabled={disabled}
              />
            ) : field.type === 'dropdown' && field.options ? (
              <ChipCombobox
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
