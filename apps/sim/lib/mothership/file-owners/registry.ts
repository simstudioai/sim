import { projectFileOwnerAdapter } from '@/lib/mothership/file-owners/project'
import type { CopilotFileOwnerAdapter } from '@/lib/mothership/file-owners/types'
import { workspaceFileOwnerAdapter } from '@/lib/mothership/file-owners/workspace'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { FileOwner } from '@/lib/workspace-files/ownership'

const adapters: FileOwnerAdapters<CopilotFileOwnerAdapter> = Object.freeze({
  workspace: workspaceFileOwnerAdapter,
  project: projectFileOwnerAdapter,
})

/** Selects owner policy without deriving file ownership from conversation context. */
export function getCopilotFileOwnerAdapter(owner: FileOwner): CopilotFileOwnerAdapter {
  return requireFileOwnerAdapter(adapters, owner)
}
