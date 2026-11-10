'use client'

import { useEffect } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { ChangelogRelease } from '@/lib/api/contracts/changelog'
import { workspacePath } from '@/lib/navigation/paths'
import { useChangelogReleases, useUpdateChangelogRelease } from '@/hooks/queries/changelog'
import { useWorkspaceFileContent, useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'
import { useOrganization } from '@/platform/lib/data/organization'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'
import { useWorkspaceUserPermissions } from '@/platform/lib/data/tables/permissions'
import {
  type ChangelogData,
  type ChangelogDetail,
  type ChangelogEntry,
  queryRead,
} from '@/platform/shared/workspace-records'

/** What editing a release reads and writes: its own fields, under the revision they were read at. */
export interface ReleaseFields {
  id: string
  title: string
  version: string
  bumpReason: string
  revision: string
}

/** A release as a changelog entry: Sim publishes it, so it names no contributor or issue. */
function toEntry(release: ChangelogRelease): ChangelogEntry {
  return {
    id: release.id,
    title: release.title,
    description: release.bumpReason,
    appliedAt: Date.parse(release.publishedAt),
    version: release.version,
  }
}

function toDetail(
  scope: SurfaceScope,
  release: ChangelogRelease,
  workspace: { id: string; name: string }
): ChangelogDetail {
  return {
    ...toEntry(release),
    workspace,
    referenceTime: Date.now(),
    body: [],
    changes: release.changes.map((change) => ({
      id: change.id,
      text: change.text,
      href: change.chatId
        ? surfaceHref(scope, `/chat/${encodeURIComponent(change.chatId)}`)
        : undefined,
    })),
    workspaceChanges: release.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      type:
        workflow.deploymentVersion === null
          ? 'Workflow, not deployed'
          : `Workflow, version ${workflow.deploymentVersion}`,
      href: workspacePath(workspace.id, `workflows/${encodeURIComponent(workflow.id)}`),
      icon: 'I118' as const,
    })),
  }
}

function useReleases(workspaceId: string) {
  const query = useChangelogReleases(workspaceId)
  const read = queryRead(query, 'The changelog could not be loaded.')
  return { query, read, releases: query.data?.pages.flatMap((page) => page.releases) ?? [] }
}

/** Whether the viewer may edit the workspace's releases; the page itself is gated on the server. */
export function useChangelogAccess(workspaceId: string) {
  return { canEdit: useWorkspaceUserPermissions(workspaceId).canEdit }
}

/** Every release Sim published in the workspace, newest first, read a page at a time. */
export function useLiveChangelog(workspaceId: string) {
  const { query, read, releases } = useReleases(workspaceId)
  const data: ChangelogData = {
    workspace: { id: workspaceId, live: true },
    referenceTime: Date.now(),
    updatedAt: query.dataUpdatedAt,
    entries: releases.map(toEntry),
  }
  return {
    read,
    data,
    older: {
      hasMore: query.hasNextPage,
      loading: query.isFetchingNextPage,
      error: query.isFetchNextPageError
        ? getErrorMessage(query.error, 'Older releases could not be loaded.')
        : undefined,
      onLoadMore: () => void query.fetchNextPage(),
    },
  }
}

/**
 * One release. The API lists releases a page at a time, so pages are read until the release turns
 * up or the history ends.
 */
export function useLiveRelease(
  workspaceId: string,
  releaseId: string,
  workspace: { id: string; name: string } | undefined
) {
  const organization = useOrganization()
  const { query, read, releases } = useReleases(workspaceId)
  const release = releases.find((item) => item.id === releaseId)
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const searching = !release && hasNextPage && !isFetchNextPageError
  useEffect(() => {
    if (searching && !isFetchingNextPage) void fetchNextPage()
  }, [searching, isFetchingNextPage, fetchNextPage])
  const releaseRead =
    read.status !== 'ready' || (release && workspace)
      ? read
      : !release && isFetchNextPageError
        ? {
            status: 'error' as const,
            message: getErrorMessage(query.error, 'This release could not be loaded.'),
            onRetry: () => void fetchNextPage(),
          }
        : ({ status: 'pending' } as const)
  return {
    read: releaseRead,
    missing: query.status === 'success' && !release && !hasNextPage,
    release,
    detail: release && workspace && toDetail(organization, release, workspace),
  }
}

/** Saves a release's title, version or reason under the revision it was read at. */
export function useReleaseEdit(workspaceId: string) {
  return useUpdateChangelogRelease(workspaceId)
}

/** A release's notes, the markdown file Sim wrote beside it. */
export function useReleaseNotes(workspaceId: string, fileId: string) {
  const record = useWorkspaceFileRecord(workspaceId, fileId)
  const content = useWorkspaceFileContent(workspaceId, fileId, record.data?.key ?? '')
  return {
    missing: record.data === null,
    error: record.error ?? content.error,
    content: content.data,
    retrying: record.isFetching || content.isFetching,
    retry: () => void (record.error ? record.refetch() : content.refetch()),
  }
}
