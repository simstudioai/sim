'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { Columns2, Eye, Pencil, PlayOutline, ShieldCheck } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { WorkflowTestDetail } from '@/lib/api/contracts/workflow-tests'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  FileViewer,
  type PreviewMode,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { TestDashboard } from '@/app/workspace/[workspaceId]/tests/components/test-dashboard'
import {
  useRefreshWorkflowTest,
  useRunWorkflowTests,
  useWorkflowTest,
} from '@/hooks/queries/workflow-tests'
import { useAddressedWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

interface TestTarget {
  workspaceId: string
  name: string
}

/** Tests run here against the deployed workflows; Sim runs drafts while it edits them. */
const VERSION = 'deployed' as const

const NEXT_PREVIEW_MODE: Record<PreviewMode, PreviewMode> = {
  editor: 'split',
  split: 'preview',
  preview: 'editor',
}

/** The test's page: the shared view under a header that switches its mode and runs it. */
export function TestDetail({ workspaceId, name }: TestTarget) {
  const router = useRouter()
  const query = useWorkflowTest(workspaceId, name)
  const run = useTestRunAction({ workspaceId, name, running: isRunning(query.data) })
  const [previewMode, setPreviewMode] = useState<PreviewMode>('preview')

  return (
    <Resource>
      <Resource.Header
        breadcrumbs={[
          {
            label: 'Tests',
            icon: ShieldCheck,
            onClick: () => router.push(`/workspace/${workspaceId}/tests`),
          },
          { label: query.data?.test.title ?? name },
        ]}
        actions={[
          {
            text: previewMode === 'editor' ? 'Split' : previewMode === 'split' ? 'Preview' : 'Edit',
            icon: previewMode === 'editor' ? Columns2 : previewMode === 'split' ? Eye : Pencil,
            onSelect: () => setPreviewMode((mode) => NEXT_PREVIEW_MODE[mode]),
          },
          run,
        ]}
      />
      <TestView workspaceId={workspaceId} name={name} previewMode={previewMode} />
    </Resource>
  )
}

interface TestRunActionInput extends TestTarget {
  running: boolean
}

/** The Run action for one test, shared by the page header and the chat tab. */
export function useTestRunAction({ workspaceId, name, running }: TestRunActionInput) {
  const canEdit = useUserPermissionsContext().canEdit === true
  const runTests = useRunWorkflowTests(workspaceId)
  const busy = running || runTests.isPending
  return {
    id: 'run',
    icon: PlayOutline,
    text: busy ? 'Running…' : 'Run',
    disabled: !canEdit || busy,
    onSelect: () =>
      runTests.mutate(
        { version: VERSION, names: [name] },
        { onError: (error) => toast.error(error.message) }
      ),
  }
}

function isRunning(detail: WorkflowTestDetail | undefined): boolean {
  return detail?.latestRun?.status === 'running'
}

interface TestViewProps extends TestTarget {
  previewMode: PreviewMode
}

/**
 * A test file shown the way an HTML file is: its source, its results as the preview, or both
 * side by side. The results are what the file declared at its last save. Shared by the test page
 * and its resource tab in Chat. Every save is checked on the server; a refused save keeps the
 * edit and says why above the editor.
 */
export function TestView({ workspaceId, name, previewMode }: TestViewProps) {
  const canEdit = useUserPermissionsContext().canEdit === true
  const query = useWorkflowTest(workspaceId, name)
  const refreshTest = useRefreshWorkflowTest(workspaceId, name)
  const [saveError, setSaveError] = useState<string | null>(null)
  const detail = query.data
  const file = useAddressedWorkspaceFileRecord(workspaceId, detail?.test.fileId ?? '', {
    enabled: Boolean(detail),
  })

  const error = query.error ?? file.error
  if (error) {
    return (
      <p role='alert' className='p-6 text-[var(--text-error)] text-small'>
        {error.message}
      </p>
    )
  }
  if (!detail || !file.data) return null

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      {saveError && previewMode !== 'preview' && (
        <div
          role='alert'
          className='border-[var(--border)] border-b px-5 py-2.5 text-[var(--text-error)] text-small'
        >
          <span className='text-[var(--text-primary)]'>Not saved: </span>
          <span className='whitespace-pre-wrap font-mono text-caption'>{saveError}</span>
        </div>
      )}
      <FileViewer
        key={file.data.id}
        file={file.data}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode}
        preview={<TestDashboard workspaceId={workspaceId} name={name} detail={detail} />}
        sourceSide='end'
        enableFind
        onSaveError={(saveFailure) =>
          setSaveError(getErrorMessage(saveFailure, 'The test file was not saved'))
        }
        onSaveStatusChange={(status) => {
          if (status !== 'saved') return
          setSaveError(null)
          refreshTest()
        }}
      />
    </div>
  )
}
