'use client'

import { lazy, Suspense } from 'react'
import { Button } from '@sim/emcn/button'
import { SelectField, TextField } from '@sim/emcn/field'
import styles from '@/app/(product)/_components/workspace/knowledge/connector-fields/connector-fields.module.css'
import {
  type ConfigFieldMap,
  type ConfigFieldValue,
  type ConnectorAccessMode,
  type ConnectorConfigField,
  type ConnectorMeta,
  isConnectorFieldRequired,
  type SourceSelectionLabel,
} from '@/platform/lib/data/knowledge/connectors'

interface ConnectorFieldsProps {
  accessMode: ConnectorAccessMode
  connectorConfig: ConnectorMeta
  sourceConfig: ConfigFieldMap
  selectionLabels?: Record<string, SourceSelectionLabel[] | undefined>
  /** The account selector fields browse with. */
  credentialId: string | null
  credentialType?: string
  canonicalGroups: Map<string, ConnectorConfigField[]>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  isFieldVisible: (field: ConnectorConfigField) => boolean
  onFieldChange: (
    fieldId: string,
    value: ConfigFieldValue,
    selectedOptions?: SourceSelectionLabel[]
  ) => void
  onToggleCanonicalMode: (canonicalId: string) => void
  disabled: boolean
}

/**
 * Provider selectors reach the selector registry, which carries every block's definition, so they
 * load only when a source with a selector field is being configured.
 */
const ConnectorSelectorField = lazy(() =>
  import(
    '@/app/(product)/_components/workspace/knowledge/connector-selector-field/connector-selector-field'
  ).then((module) => ({ default: module.ConnectorSelectorField }))
)

/**
 * A connector's configuration, one field per row as its registry entry declares it: a provider
 * selector, a fixed choice, or text. A field with both a selector and a manual form switches
 * between them, keeping one value; administrator access can rename or require a field.
 */
export function ConnectorFields(props: ConnectorFieldsProps) {
  return props.connectorConfig.configFields.map((field) =>
    props.isFieldVisible(field) ? (
      <ConnectorField key={field.id} field={field} fields={props} />
    ) : null
  )
}

function ConnectorField({
  field,
  fields: {
    accessMode,
    connectorConfig,
    sourceConfig,
    selectionLabels,
    credentialId,
    credentialType,
    canonicalGroups,
    canonicalModes,
    onFieldChange,
    onToggleCanonicalMode,
    disabled,
  },
}: {
  field: ConnectorConfigField
  fields: ConnectorFieldsProps
}) {
  const label = accessMode === 'admin' ? (field.titleInAdminMode ?? field.title) : field.title
  const hint =
    accessMode === 'admin' ? (field.descriptionInAdminMode ?? field.description) : field.description
  const optional = !isConnectorFieldRequired(field, connectorConfig, accessMode)
  const canonicalId = field.canonicalParamId
  const paired = Boolean(canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2)
  const raw = sourceConfig[field.id] ?? (field.multi ? [] : '')
  const selectorKey = field.type === 'selector' ? field.selectorKey : undefined
  const control = selectorKey ? (
    <ConnectorSelectorField
      field={{ ...field, selectorKey }}
      label={optional ? `${label} (optional)` : label}
      hint={hint}
      value={raw}
      onChange={(value, selected) => onFieldChange(field.id, value, selected)}
      selectedLabels={selectionLabels?.[field.canonicalParamId ?? field.id]}
      credentialId={credentialId}
      serviceAccountSubjectFieldId={
        credentialType === 'service_account' && connectorConfig.auth.mode === 'oauth'
          ? connectorConfig.auth.serviceAccountSubjectFieldId
          : undefined
      }
      sourceConfig={sourceConfig}
      configFields={connectorConfig.configFields}
      canonicalModes={canonicalModes}
      disabled={disabled}
    />
  ) : field.type === 'dropdown' && field.options ? (
    <SelectField
      label={label}
      optional={optional}
      hint={hint}
      disabled={disabled}
      value={typeof raw === 'string' && raw ? raw : undefined}
      onValueChange={(value) => onFieldChange(field.id, value)}
      options={field.options.map((option) => ({ value: option.id, label: option.label }))}
    />
  ) : (
    <TextField
      label={label}
      optional={optional}
      hint={hint}
      disabled={disabled}
      placeholder={field.placeholder ?? `Enter ${label.toLowerCase()}`}
      value={Array.isArray(raw) ? raw.join(', ') : raw}
      onChange={(value) => onFieldChange(field.id, value)}
      autoComplete='off'
    />
  )
  const content =
    paired && canonicalId ? (
      <div className={styles.paired}>
        {control}
        <span className={styles.switch}>
          <Button
            variant='quiet'
            size='compact'
            disabled={disabled}
            aria-label={`Switch ${label} to ${field.mode === 'basic' ? 'manual input' : 'selector'}`}
            onClick={() => onToggleCanonicalMode(canonicalId)}
          >
            {field.mode === 'basic' ? 'Enter manually' : 'Choose from list'}
          </Button>
        </span>
      </div>
    ) : (
      control
    )
  return selectorKey ? <Suspense fallback={null}>{content}</Suspense> : content
}
