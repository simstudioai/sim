import type { ComponentType } from 'react'
import type { WorkspaceSettingsKey } from '@/platform/lib/data/workspace-settings'

/**
 * What a workspace Settings section receives. Its navigation gate has already passed; its own API
 * calls enforce the same rule. A section reads what it may change from `useWorkspaceSettingsSection`.
 */
export interface WorkspaceSettingsSectionProps {
  workspaceId: string
  /** Segments after the section's key, limited to its declared `subpaths`. */
  subpath: readonly string[]
  query: Record<string, string | string[] | undefined>
}

interface WorkspaceSettingsSectionEntry {
  load: () => Promise<{ default: ComponentType<WorkspaceSettingsSectionProps> }>
  subpaths?: readonly string[]
}

/**
 * One lazily loaded folder per section, so a section's owner edits only that folder. The `Record`
 * makes a section missing from this map or from `lib/data/workspace-settings` a compile error.
 */
export const WORKSPACE_SETTINGS_SECTIONS: Record<
  WorkspaceSettingsKey,
  WorkspaceSettingsSectionEntry
> = {
  teammates: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/teammates/teammates-section'
      ),
  },
  secrets: {
    subpaths: [':credentialId'],
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/secrets/secrets-section'
      ),
  },
  byok: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/byok/byok-section'
      ),
  },
  sandboxes: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/sandboxes/sandboxes-section'
      ),
  },
  requests: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/requests/requests-section'
      ),
  },
  'custom-tools': {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/custom-tools/custom-tools-section'
      ),
  },
  mcp: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/mcp/mcp-section'
      ),
  },
  'workflow-mcp-servers': {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/workflow-mcp-servers-section'
      ),
  },
  'api-keys': {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/api-keys/api-keys-section'
      ),
  },
  inbox: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/inbox/inbox-section'
      ),
  },
  'recently-deleted': {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/recently-deleted/recently-deleted-section'
      ),
  },
  forks: {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/forks-section'
      ),
  },
  'custom-blocks': {
    load: () =>
      import(
        '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/custom-blocks-section'
      ),
  },
}
