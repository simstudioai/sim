import { useId, useRef, useState } from 'react'
import { Button, FieldFrame, Select } from '@/platform/design-system/components'
import type { IntegrationSource } from '@/platform/lib/integrations/model'

type GitLabPermissions = NonNullable<IntegrationSource['gitlabPermissions']>

interface MappingFileProps {
  label: string
  value: string
  onChange: (name: string) => void
}

function MappingFile({ label, value, onChange }: MappingFileProps) {
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const [error, setError] = useState('')
  return (
    <FieldFrame label={label} id={id} error={error}>
      <Button
        render={<button aria-label={`Choose ${label}`} />}
        onClick={() => input.current?.click()}
      >
        {value || 'Choose a CSV file'}
      </Button>
      <input
        id={id}
        ref={input}
        type='file'
        hidden
        accept='.csv,text/csv'
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          if (!/\.csv$/i.test(file.name) || file.size === 0 || file.size > 4 * 1024 * 1024) {
            setError('Choose a nonempty CSV file up to 4 MB.')
            onChange('')
            return
          }
          setError('')
          onChange(file.name)
        }}
      />
    </FieldFrame>
  )
}

interface GitLabPermissionsFieldsProps {
  value: GitLabPermissions
  onChange: (permissions: GitLabPermissions) => void
}

export function GitLabPermissionsFields({ value, onChange }: GitLabPermissionsFieldsProps) {
  return (
    <>
      <FieldFrame label='Permission source'>
        <Select
          label='Permission source'
          value={value.mode}
          options={[
            { value: 'administrator', label: 'GitLab administrator' },
            { value: 'csv', label: 'CSV mappings' },
          ]}
          onValueChange={(mode) =>
            onChange(
              mode === 'csv'
                ? { mode, userMapping: '', projectPermissions: '' }
                : { mode: 'administrator' }
            )
          }
        />
      </FieldFrame>
      {value.mode === 'csv' && (
        <>
          <MappingFile
            label='User mapping CSV'
            value={value.userMapping}
            onChange={(userMapping) => onChange({ ...value, userMapping })}
          />
          <MappingFile
            label='Project permissions CSV'
            value={value.projectPermissions}
            onChange={(projectPermissions) => onChange({ ...value, projectPermissions })}
          />
          <p data-type='T050'>
            Map user IDs to email addresses in the first file and project paths to user IDs in the
            second.
          </p>
        </>
      )}
    </>
  )
}
