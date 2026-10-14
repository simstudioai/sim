/**
 * A containing pane that hosts the full editor beside its own chat. The editor renders its
 * header bar (workflow actions, Deploy, Run) into `header` and leaves out its Chat tab.
 */
export interface WorkflowPaneHost {
  /** The pane's header slot; null until the pane has mounted it. */
  header: HTMLElement | null
}
