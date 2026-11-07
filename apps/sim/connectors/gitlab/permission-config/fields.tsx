'use client'

import { Chip, ChipModalField, ChipModalTabs } from '@sim/emcn-legacy'
import {
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
} from '@/connectors/gitlab/permission-config/csv-files'
import type { GitLabCsvKind } from '@/connectors/gitlab/permission-config/types'
import type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'

interface GitLabPermissionFieldsProps {
  form: GitLabPermissionForm
  disabled?: boolean
}

export function GitLabPermissionTabs({ form, disabled }: GitLabPermissionFieldsProps) {
  return (
    <fieldset disabled={disabled} className='mx-2 border-0 p-0'>
      <ChipModalTabs
        tabs={GITLAB_TOKEN_TABS}
        value={form.mode}
        aria-label='GitLab token type'
        onChange={(value) => {
          if (!disabled && (value === 'administrator' || value === 'csv')) form.setMode(value)
        }}
      />
    </fieldset>
  )
}

export function GitLabPermissionUploads({ form, disabled }: GitLabPermissionFieldsProps) {
  if (form.mode !== 'csv') return null
  return (
    <>
      <p className='px-2 text-[var(--text-muted)] text-caption'>
        Update these files when access changes. Confidential issues are excluded.
      </p>
      {(['userMapping', 'projectPermissions'] as const).map((kind) => (
        <GitLabCsvFile key={kind} kind={kind} form={form} disabled={disabled} />
      ))}
    </>
  )
}

interface GitLabCsvFileProps extends GitLabPermissionFieldsProps {
  kind: GitLabCsvKind
}

function GitLabCsvFile({ kind, form, disabled }: GitLabCsvFileProps) {
  const definition = GITLAB_CSV_FILES[kind]
  const selected = form.files[kind]
  const saved = form.saved?.[kind]
  const filename = selected?.upload?.filename ?? saved?.filename
  const count = selected?.rowCount ?? saved?.rowCount
  const downloadTemplate = () => {
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(definition.template)}`
    link.download = definition.filename
    link.click()
  }
  return (
    <ChipModalField
      type='file'
      title={definition.title}
      titleActions={
        <Chip
          onClick={downloadTemplate}
          aria-label={`Download ${definition.title.toLowerCase()} template`}
        >
          Download template
        </Chip>
      }
      required
      accept='.csv,text/csv'
      disabled={disabled}
      loading={selected?.loading}
      label={selected?.loading ? 'Validating…' : (filename ?? 'Drop CSV or click to upload')}
      error={selected?.error}
      description={
        filename && count !== undefined && !selected?.loading
          ? `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'} · ${selected?.upload ? 'Ready to save' : 'Saved'}`
          : undefined
      }
      onChange={(files) => {
        if (files[0]) void form.selectFile(kind, files[0])
      }}
    />
  )
}
