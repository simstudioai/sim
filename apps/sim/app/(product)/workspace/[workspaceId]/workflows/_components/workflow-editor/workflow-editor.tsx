'use client'

import { type RefObject, useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { WorkflowCanvas } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/workflow-canvas'
import {
  GlobalCommandsProvider,
  useRegisterGlobalCommands,
} from '@/app/(product)/_components/workspace/workflows/global-commands/global-commands'
import { LiveWorkspacePage } from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import {
  RightPanel,
  useRightPanelTab,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/right-panel/right-panel'
import { Terminal } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/terminal'
import type { ToolbarRef } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/toolbar/toolbar'
import { VariablesPanel } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/variables/variables-panel'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflow-editor/workflow-editor.module.css'
import {
  WorkflowActions,
  WorkflowTrail,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflow-header/workflow-header'
import { createCommand, WorkflowScopeProvider } from '@/platform/lib/data/workflows'

interface WorkflowEditorProps {
  workspaceId: string
  workflowId: string
}

/** Mod+F from outside a field: the legacy panel's "focus toolbar search", on the Toolbar tab. */
function ToolbarSearchCommand({ toolbarRef }: { toolbarRef: RefObject<ToolbarRef | null> }) {
  const [, select] = useRightPanelTab()
  useRegisterGlobalCommands(() => [
    createCommand({
      id: 'focus-toolbar-search',
      handler: () => {
        select('toolbar')
        toolbarRef.current?.focusSearch()
      },
      overrides: { allowInEditable: false },
    }),
  ])
  return null
}

/**
 * The Workflows tab's editor: the workspace heading, tabs and the workflow's control bar (where it
 * sits, its commands, Run), then the canvas across the pane with the right panel beside it. The
 * terminal's slot is beneath the canvas in `.stage`.
 */
export function WorkflowEditor({ workspaceId, workflowId }: WorkflowEditorProps) {
  const toolbarRef = useRef<ToolbarRef>(null)
  return (
    <WorkflowScopeProvider workspaceId={workspaceId} workflowId={workflowId}>
      <ReactFlowProvider>
        <GlobalCommandsProvider>
          <ToolbarSearchCommand toolbarRef={toolbarRef} />
          <LiveWorkspacePage
            workspaceId={workspaceId}
            current='workflows'
            layout='canvas'
            controls={
              <ControlBar
                trail={<WorkflowTrail workspaceId={workspaceId} workflowId={workflowId} />}
              >
                <WorkflowActions workspaceId={workspaceId} workflowId={workflowId} />
              </ControlBar>
            }
          >
            <div className={styles.workspace}>
              <div className={styles.stage}>
                <WorkflowCanvas workspaceId={workspaceId} workflowId={workflowId} />
                <Terminal />
              </div>
              <RightPanel toolbarRef={toolbarRef} variables={<VariablesPanel />} />
            </div>
          </LiveWorkspacePage>
        </GlobalCommandsProvider>
      </ReactFlowProvider>
    </WorkflowScopeProvider>
  )
}
