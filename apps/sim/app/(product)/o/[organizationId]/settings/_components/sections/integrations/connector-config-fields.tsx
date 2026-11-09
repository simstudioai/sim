'use client'

import { lazy, Suspense } from 'react'
import { Button } from '@sim/emcn/button'
import { SelectField, TextField } from '@sim/emcn/field'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/connector-config-fields.module.css'
import {
  type ConnectorConfigField,
  isConnectorFieldRequired,
} from '@/platform/lib/data/knowledge/connectors'
import type { ConnectorConfigFieldsProps } from '@/platform/lib/data/search-sources'

interface ConnectorConfigFieldsListProps {
  config: Omit<ConnectorConfigFieldsProps, 'isFieldVisible'>
  isFieldVisible: ConnectorConfigFieldsProps['isFieldVisible']
}

/**
 * Provider selectors reach the selector registry, which carries every block's definition, so they
 * load only when a source with a selector field is being configured.
 */
const ConnectorSelectorField = lazy(() =>
  import(
    '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/connector-selector'
  ).then((module) => ({ default: module.ConnectorSelectorField }))
)

/** A connection's dynamic configuration fields, with their selector/manual pairs. */
export function ConnectorConfigFields({ config, isFieldVisible }: ConnectorConfigFieldsListProps) {
  return config.connectorConfig.configFields.map((field) =>
    isFieldVisible(field) ? (
      <ConnectorConfigRow key={field.id} field={field} config={config} />
    ) : null
  )
}

function ConnectorConfigRow({
  field,
  config: {
    scope,
    accessMode = 'workspace',
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
  config: ConnectorConfigFieldsListProps['config']
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
      scope={scope}
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
