import type { MothershipResource } from '@/lib/copilot/resources/types'

/** A workspace's staged resource: the single thing the panel is showing. */
export interface WorkspaceStageState {
  resource: MothershipResource | null
}

/**
 * The resource panel's stage, owned per workspace. The panel shows exactly one
 * resource at a time — whatever the Mothership conversation last touched (or
 * the user last attached). There is no tab strip: staging a new resource
 * replaces the previous one.
 */
export interface MothershipStageState {
  byWorkspace: Record<string, WorkspaceStageState>
  /**
   * Stages a resource as the panel's content, replacing whatever was staged.
   * Ephemeral resources (streaming previews) are skipped — they render via
   * chat-local state and never persist.
   */
  setStage: (workspaceId: string, resource: MothershipResource) => void
  /** Clears the staged resource (the panel collapses). */
  clearStage: (workspaceId: string) => void
}
