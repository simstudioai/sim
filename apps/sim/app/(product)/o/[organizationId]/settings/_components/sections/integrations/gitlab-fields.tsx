'use client'

import { Button } from '@sim/emcn/button'
import { FileField } from '@sim/emcn/field/file-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
  type GitLabPermissionForm,
} from '@/platform/lib/data/knowledge/connectors'
import { saveFile } from '@/platform/lib/data/search-sources'
import { LOCALE } from '@/platform/shared/time'

interface GitLabFieldsProps {
  form: GitLabPermissionForm
  disabled?: boolean
}

export function GitLabTokenTabs({ form, disabled }: GitLabFieldsProps) {
  return (
    <SegmentedControl
      label='GitLab token type'
      value={form.mode}
      options={GITLAB_TOKEN_TABS.map((tab) => ({ ...tab, disabled }))}
      onSelect={(value) => {
        if (!disabled) form.setMode(value)
      }}
    />
  )
}

/** Uploaded mappings stay in the form's ephemeral state, never in a saved draft. */
export function GitLabCsvUploads({ form, disabled }: GitLabFieldsProps) {
  if (form.mode !== 'csv') return null
  return (
    <>
      <Muted>Update these files when access changes. Confidential issues are excluded.</Muted>
      {(['userMapping', 'projectPermissions'] as const).map((kind) => {
        const definition = GITLAB_CSV_FILES[kind]
        const selected = form.files[kind]
        const saved = form.saved?.[kind]
        const filename = selected?.upload?.filename ?? saved?.filename
        const count = selected?.rowCount ?? saved?.rowCount
        return (
          <div key={kind}>
            <FileField
              label={definition.title}
              accept='.csv,text/csv'
              disabled={disabled || selected?.loading}
              prompt={selected?.loading ? 'Validating…' : 'Drop CSV or click to upload'}
              selection={
                filename
                  ? {
                      name: filename,
                      detail:
                        count !== undefined && !selected?.loading
                          ? `${count.toLocaleString(LOCALE)} ${count === 1 ? 'row' : 'rows'} · ${selected?.upload ? 'Ready to save' : 'Saved'}`
                          : undefined,
                    }
                  : undefined
              }
              error={selected?.error}
              onFileChange={(file) => void form.selectFile(kind, file)}
            />
            <Button
              variant='quiet'
              size='compact'
              onClick={() =>
                saveFile(
                  new Blob([definition.template], { type: 'text/csv;charset=utf-8' }),
                  definition.filename
                )
              }
            >
              Download template
            </Button>
          </div>
        )
      })}
    </>
  )
}
