import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { GitLabPermissionsFields } from '@/platform/app/(shell)/integrations/_components/search-settings/gitlab-permissions'
import styles from '@/platform/app/(shell)/integrations/_components/search-settings/search-settings.module.css'
import {
  type ScopeField,
  SOURCE_FIELDS,
} from '@/platform/app/(shell)/integrations/_components/search-settings/source-fields'
import {
  Disclosure,
  Modal,
  PropertyList,
  SelectField,
  TextField,
} from '@/platform/design-system/components'
import type { IntegrationProvider, IntegrationSource } from '@/platform/lib/integrations/model'

interface SourceEditorProps {
  provider: IntegrationProvider
  source?: IntegrationSource
  onSave: (source: IntegrationSource) => void
  onClose: () => void
}

export function SourceEditor({ provider, source, onSave, onClose }: SourceEditorProps) {
  const fields = SOURCE_FIELDS[provider.id.replaceAll('-', '_')] ?? []
  const existing = source?.scope ?? []
  const additional = existing.filter(
    (entry) => !fields.some((field) => field.label === entry.label)
  )
  const [permissions, setPermissions] = useState<
    NonNullable<IntegrationSource['gitlabPermissions']>
  >(source?.gitlabPermissions ?? { mode: 'administrator' })
  const incompleteMappings =
    permissions.mode === 'csv' && (!permissions.userMapping || !permissions.projectPermissions)
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={source ? 'Edit search source' : 'Set up a search source'}
      description={
        source && !source.draft
          ? provider.name
          : 'Save the source settings. Provider authorization is required before this source can be used for search.'
      }
      confirmLabel={source && !source.draft ? 'Save changes' : 'Save source draft'}
      confirmDisabled={provider.id === 'gitlab' && Boolean(incompleteMappings)}
      onConfirm={(values) => {
        const scope = [
          ...additional,
          ...fields.flatMap(({ label, multiple, identity }) => {
            const saved = existing.find((field) => field.label === label)
            if (identity && source && !source.draft && saved) return [saved]
            const value = String(values.get(label) ?? '').trim()
            const items = multiple
              ? value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : value
                ? [value]
                : []
            return items.length ? [{ label, values: items }] : []
          }),
        ]
        onSave({
          ...(source ?? {
            id: generateId(),
            mode: 'service_account',
            available: false,
            enabled: false,
            draft: true,
          }),
          label: String(values.get('name')).trim(),
          scope,
          ...(provider.id === 'gitlab' && { gitlabPermissions: permissions }),
        })
      }}
    >
      <TextField
        required
        pattern='.*\S.*'
        name='name'
        label='Source name'
        defaultValue={source?.label}
      />
      {fields
        .filter((field) => field.required)
        .map((field) => (
          <SourceField key={field.label} field={field} source={source} />
        ))}
      {provider.id === 'gitlab' && (
        <GitLabPermissionsFields value={permissions} onChange={setPermissions} />
      )}
      {fields.some((field) => !field.required) && (
        <Disclosure label='Additional filters'>
          <div className={styles.filters}>
            {fields
              .filter((field) => !field.required)
              .map((field) => (
                <SourceField key={field.label} field={field} source={source} />
              ))}
          </div>
        </Disclosure>
      )}
      {additional.length > 0 && (
        <PropertyList
          title='Source scope'
          properties={additional.map((entry) => ({
            id: entry.label,
            label: entry.label,
            kind: 'text',
            value: entry.values.join(', '),
          }))}
        />
      )}
    </Modal>
  )
}

interface SourceFieldProps {
  field: ScopeField
  source?: IntegrationSource
}

function SourceField({ field, source }: SourceFieldProps) {
  const value = source?.scope?.find((entry) => entry.label === field.label)?.values.join(', ')
  return field.choices ? (
    <SelectField
      name={field.label}
      label={field.label}
      defaultValue={value ?? field.choices[0]}
      options={field.choices.map((choice) => ({ value: choice, label: choice }))}
    />
  ) : (
    <TextField
      name={field.label}
      label={field.label}
      required={field.required}
      optional={!field.required}
      disabled={field.identity && Boolean(source && !source.draft && value)}
      pattern={field.pattern ?? (field.required ? '.*\\S.*' : undefined)}
      placeholder={field.placeholder}
      defaultValue={value}
    />
  )
}
