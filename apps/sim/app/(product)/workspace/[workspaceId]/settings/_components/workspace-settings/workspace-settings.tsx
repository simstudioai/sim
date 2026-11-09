'use client'

import { type ReactNode, useState } from 'react'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { SettingsNavigation } from '@/app/(product)/_components/settings-navigation/settings-navigation'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
  WorkspacePage,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type { WorkspaceSummary } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/workspace-settings/workspace-settings.module.css'
import { getMyAccessRequestHref } from '@/platform/lib/data/requests'
import {
  useWorkspaceSettings,
  type WorkspaceSettingsKey,
} from '@/platform/lib/data/workspace-settings'
import { platformHref } from '@/platform/lib/navigation'

/** Example workspaces have no settings to show: the tab is in place and empty. */
export function WorkspaceSettings({ workspace }: { workspace: WorkspaceSummary }) {
  return <WorkspacePage workspace={workspace} current='settings' />
}

interface RestrictedSectionProps {
  workspaceId: string
  restriction: ReturnType<ReturnType<typeof useWorkspaceSettings>['restriction']>
}

/** A section the viewer's permission group withholds, offering the request they may make for it. */
function RestrictedSection({ workspaceId, restriction }: RestrictedSectionProps) {
  const router = useRouter()
  const search = useSearchParams()
  const [requesting, setRequesting] = useState(false)
  const { entry, accepting } = restriction
  const requestable = accepting && entry?.state === 'requestable'
  return (
    <>
      <WorkspaceEmpty
        title='Access required'
        description={
          requestable
            ? entry.pendingRequestId
              ? 'Your request is pending.'
              : 'Ask an administrator for access.'
            : entry?.state === 'requestable'
              ? 'Access requests are paused for your organization.'
              : 'Your organization restricts this feature.'
        }
        action={
          requestable
            ? {
                label: entry.pendingRequestId ? 'View request' : 'Request access',
                onClick: () => setRequesting(true),
              }
            : undefined
        }
      />
      {requesting && entry && (
        <RequestAccessModal
          scope={{ kind: 'workspace', workspaceId }}
          target={entry.target}
          label={entry.label}
          onViewRequest={(requestId) =>
            router.push(
              platformHref(
                getMyAccessRequestHref({ kind: 'workspace', workspaceId }, requestId),
                search
              )
            )
          }
          onClose={() => setRequesting(false)}
        />
      )}
    </>
  )
}

interface LiveWorkspaceSettingsProps {
  workspaceId: string
  section: WorkspaceSettingsKey
  children: ReactNode
}

/**
 * The workspace's Settings tab on live data: its sections in the organization Settings navigation's
 * pattern beside the open section. A section the viewer may not open answers as not found.
 */
export function LiveWorkspaceSettings({
  workspaceId,
  section,
  children,
}: LiveWorkspaceSettingsProps) {
  const search = useSearchParams()
  const settings = useWorkspaceSettings(workspaceId)
  const entry = settings.section(section)
  if (settings.status === 'ready' && !entry) notFound()
  const groups = settings.groups.map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      key: item.key,
      title: item.title,
      icon: item.icon,
      href: platformHref(workspacePath(workspaceId, `settings/${item.key}`), search),
    })),
  }))
  return (
    <LiveWorkspacePage
      workspaceId={workspaceId}
      current='settings'
      read={
        settings.status === 'error'
          ? {
              status: 'error',
              message: 'Settings could not be loaded.',
              onRetry: settings.retry,
            }
          : settings.status === 'pending'
            ? { status: 'pending' }
            : undefined
      }
    >
      {entry && (
        <div className={styles.layout}>
          <div className={styles.navigation}>
            <SettingsNavigation section={section} groups={groups} />
          </div>
          <section className={styles.section} aria-labelledby='workspace-settings-title'>
            <h2 id='workspace-settings-title' data-type='T093'>
              {entry.title}
            </h2>
            {entry.restrictedBy ? (
              <RestrictedSection
                workspaceId={workspaceId}
                restriction={settings.restriction(entry.restrictedBy)}
              />
            ) : (
              children
            )}
          </section>
        </div>
      )}
    </LiveWorkspacePage>
  )
}
