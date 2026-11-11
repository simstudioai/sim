'use client'

import { type ComponentType, Suspense } from 'react'
import dynamic from 'next/dynamic'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import type { WorkspaceSettingsKey } from '@/platform/lib/data/workspace-settings'

/**
 * One lazily loaded folder per section, so a section's owner edits only that folder and a section's
 * code loads only where it opens. The loaders run in the browser: a server component that imports a
 * client component dynamically does not split it, which put every section's code on every section.
 * The `Record` makes a section missing from this map or from `lib/data/workspace-settings` a
 * compile error.
 */
const SECTIONS: Record<WorkspaceSettingsKey, ComponentType<WorkspaceSettingsSectionProps>> = {
  teammates: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/teammates/teammates-section'
      )
  ),
  secrets: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secrets-section'
      )
  ),
  byok: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/byok-section'
      )
  ),
  sandboxes: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/sandboxes/sandboxes-section'
      )
  ),
  requests: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/requests/requests-section'
      )
  ),
  'custom-tools': dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-tools/custom-tools-section'
      )
  ),
  mcp: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/mcp/mcp-section'
      )
  ),
  'workflow-mcp-servers': dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/workflow-mcp-servers-section'
      )
  ),
  'api-keys': dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/api-keys/api-keys-section'
      )
  ),
  inbox: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/inbox/inbox-section'
      )
  ),
  'recently-deleted': dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/recently-deleted/recently-deleted-section'
      )
  ),
  forks: dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/forks-section'
      )
  ),
  'custom-blocks': dynamic(
    () =>
      import(
        '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/custom-blocks-section'
      )
  ),
}

interface WorkspaceSettingsSectionViewProps extends WorkspaceSettingsSectionProps {
  section: WorkspaceSettingsKey
}

/** The open section, which renders its own header. It paints nothing while its code loads. */
export function WorkspaceSettingsSection({
  section,
  workspaceId,
  subpath,
}: WorkspaceSettingsSectionViewProps) {
  const Section = SECTIONS[section]
  return (
    <Suspense fallback={null}>
      <Section workspaceId={workspaceId} subpath={subpath} />
    </Suspense>
  )
}
