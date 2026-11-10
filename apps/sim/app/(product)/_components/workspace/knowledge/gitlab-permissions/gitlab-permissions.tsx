'use client'

import { Button } from '@sim/emcn/button'
import { DetailsField } from '@sim/emcn/field/details-field'
import { FileField } from '@sim/emcn/field/file-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import styles from '@/app/(product)/_components/workspace/knowledge/gitlab-permissions/gitlab-permissions.module.css'
import {
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
  type GitLabPermissionForm,
} from '@/platform/lib/data/knowledge/connectors'
import { LOCALE } from '@/platform/shared/time'

const KINDS = ['userMapping', 'projectPermissions'] as const

interface GitLabPermissionsProps {
  form: GitLabPermissionForm
  disabled?: boolean
}

/** Which GitLab token mirrors permissions: an administrator's, or a member's with uploaded CSVs. */
export function GitLabTokenChoice({ form, disabled }: GitLabPermissionsProps) {
  return (
    <DetailsField label='GitLab token'>
      <SegmentedControl
        label='GitLab token type'
        value={form.mode}
        holdOnReselect
        options={GITLAB_TOKEN_TABS.map((tab) => ({ ...tab, disabled }))}
        onSelect={(mode) => {
          if (!disabled) form.setMode(mode)
        }}
      />
    </DetailsField>
  )
}

function downloadTemplate(kind: (typeof KINDS)[number]) {
  const definition = GITLAB_CSV_FILES[kind]
  const link = document.createElement('a')
  link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(definition.template)}`
  link.download = definition.filename
  link.click()
}

/**
 * With a member's token, the user mapping and project permissions come from CSV files, each read
 * and validated in the browser before it is saved. A template shows each file's columns.
 */
export function GitLabPermissionUploads({ form, disabled }: GitLabPermissionsProps) {
  if (form.mode !== 'csv') return null
  return (
    <>
      <p className={styles.note} data-type='T052'>
        Update these files when access changes. Confidential issues are excluded.
      </p>
      {KINDS.map((kind) => {
        const definition = GITLAB_CSV_FILES[kind]
        const selected = form.files[kind]
        const saved = form.saved?.[kind]
        const filename = selected?.upload?.filename ?? saved?.filename
        const count = selected?.rowCount ?? saved?.rowCount
        return (
          <div key={kind} className={styles.file}>
            <FileField
              label={definition.title}
              accept='.csv,text/csv'
              disabled={disabled || selected?.loading}
              prompt={selected?.loading ? 'Validating…' : 'Choose a CSV or drag it here'}
              selection={
                filename && !selected?.loading
                  ? {
                      name: filename,
                      detail:
                        count === undefined
                          ? undefined
                          : `${count.toLocaleString(LOCALE)} ${count === 1 ? 'row' : 'rows'} · ${selected?.upload ? 'Ready to save' : 'Saved'}`,
                    }
                  : undefined
              }
              error={selected?.error}
              onFileChange={(file) => void form.selectFile(kind, file)}
            />
            <span className={styles.template}>
              <Button
                variant='quiet'
                size='compact'
                icon='I049'
                aria-label={`Download ${definition.title.toLowerCase()} template`}
                onClick={() => downloadTemplate(kind)}
              >
                Download template
              </Button>
            </span>
          </div>
        )
      })}
    </>
  )
}
