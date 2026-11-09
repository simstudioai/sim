'use client'

import { useState } from 'react'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { FileViewer } from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/file-viewer'
import styles from '@/app/(product)/workspace/[workspaceId]/tests/_components/test-source/test-source.module.css'
import { useWorkspaceFileRecord, workspaceFileRecordState } from '@/platform/lib/data/files'
import { useRefreshWorkflowTest } from '@/platform/lib/data/workflow-tests'

interface TestSourceProps {
  workspaceId: string
  name: string
  fileId: string
  canEdit: boolean
  onDirtyChange: (dirty: boolean) => void
}

/**
 * A test's source file in the same editor Files opens it in, beside its results. Every save is
 * checked on the server: a refused save keeps the edit and says why above the editor, and an
 * accepted one rereads the test, so its cases and freshness follow what was saved.
 */
export function TestSource({ workspaceId, name, fileId, canEdit, onDirtyChange }: TestSourceProps) {
  const record = useWorkspaceFileRecord(workspaceId, fileId)
  const refreshTest = useRefreshWorkflowTest(workspaceId, name)
  const [saveError, setSaveError] = useState<string | null>(null)
  const state = workspaceFileRecordState(record)

  if (state === 'failed')
    return (
      <FailureNotice
        message={getErrorMessage(record.error, 'The test file could not be loaded.')}
        retrying={record.isFetching}
        onRetry={() => void record.refetch()}
      />
    )
  if (state === 'missing')
    return <InlineNotice intent='danger' message='This test’s file no longer exists.' />
  if (!record.data) return null

  return (
    <div className={styles.source}>
      {saveError && <InlineNotice intent='danger' title='Not saved' message={saveError} />}
      <div className={styles.editor}>
        <FileViewer
          key={record.data.id}
          file={record.data}
          workspaceId={workspaceId}
          canEdit={canEdit}
          previewMode='editor'
          enableFind
          onDirtyChange={onDirtyChange}
          onSaveError={(error) =>
            setSaveError(getErrorMessage(error, 'The test file was not saved'))
          }
          onSaveStatusChange={(status) => {
            if (status !== 'saved') return
            setSaveError(null)
            refreshTest()
          }}
        />
      </div>
    </div>
  )
}
