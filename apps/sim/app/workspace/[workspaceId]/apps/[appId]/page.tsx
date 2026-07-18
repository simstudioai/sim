'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, ChipConfirmModal, ChipSelect, Label, Loader, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowLeft, Copy, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { AppPreviewBridge } from '@/components/apps/preview-bridge'
import { isApiClientError } from '@/lib/api/client/errors'
import type { AppRelease } from '@/lib/api/contracts/apps'
import { publishAppWithDeploy } from '@/lib/apps/client'
import { DRAFT_DEPLOYMENT_VERSION_SENTINEL } from '@/lib/apps/draft-binding'
import { buildAppPreviewUrl } from '@/lib/apps/preview-url'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'
import {
  useAppProject,
  useArchiveAppProject,
  useBindAppRevision,
  useBuildAppRevision,
  useCreateAppPreviewSession,
  usePrepareAppRelease,
  usePublishAppRelease,
  useRevokeAppRelease,
  useRollbackAppRelease,
} from '@/hooks/queries/apps'
import { useDeploymentVersions } from '@/hooks/queries/deployments'
import { useWorkflowMap } from '@/hooks/queries/workflows'

type ConfirmAction =
  | { type: 'publish' }
  | { type: 'revoke'; releaseId: string }
  | { type: 'rollback'; releaseId: string }
  | { type: 'archive' }
  | null

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function appActionErrorMessage(error: unknown, fallback: string): string {
  if (isApiClientError(error)) {
    switch (error.code) {
      case 'ARTIFACT_MISSING':
        return 'The retained artifact is no longer available. Rebuild the current revision and publish a new release.'
      case 'APPS_ORIGIN_MISCONFIGURED':
      case 'APPS_ORIGIN_DISABLED':
        return 'Apps hosting is not configured correctly. Check APP_PUBLIC_ORIGIN, NEXT_PUBLIC_APP_URL, and APPS_PROXY_HOP_SECRET.'
      case 'FIXTURE_BUILDS_DISABLED':
        return 'This diagnostic build cannot be published. Rebuild with local Vite or E2B.'
      case 'LOCAL_BUILD_NOT_ALLOWED':
      case 'E2B_BUILD_REQUIRED':
        return 'Production publishing requires a build from the configured E2B app-build image.'
      case 'TURNSTILE_NOT_CONFIGURED':
        return 'Production publishing requires Cloudflare Turnstile configuration.'
    }
  }
  return getErrorMessage(error, fallback)
}

function buildModeLabel(mode: unknown): string {
  switch (mode) {
    case 'local-vite':
      return 'Local Vite'
    case 'e2b':
      return 'E2B'
    case 'fixture-hash-only':
      return 'Dev diagnostic'
    default:
      return 'Unknown'
  }
}

function parseSelectedOutputs(selected: string[]) {
  const usedKeys = new Set<string>()
  return selected.flatMap((outputId, index) => {
    const split = outputId.indexOf('_')
    if (split <= 0 || split >= outputId.length - 1) return []
    const blockId = outputId.slice(0, split)
    const path = outputId.slice(split + 1)
    const rawKey =
      path
        .split('.')
        .at(-1)
        ?.replace(/[^a-zA-Z0-9_]/g, '_') || `output_${index + 1}`
    let key = /^[a-zA-Z_]/.test(rawKey) ? rawKey : `output_${rawKey}`
    let suffix = 2
    while (usedKeys.has(key)) {
      key = `${rawKey}_${suffix++}`
    }
    usedKeys.add(key)
    return [{ key, blockId, path }]
  })
}

export default function AppBuilderPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const appId = params.appId as string
  const permissions = useUserPermissionsContext()
  const canEdit = permissions.canEdit === true
  const canAdmin = permissions.canAdmin === true

  const detailQuery = useAppProject(appId, { enabled: canEdit })
  const { data: workflowMap = {}, isLoading: workflowsLoading } = useWorkflowMap(
    canEdit ? workspaceId : undefined
  )
  const [workflowId, setWorkflowId] = useState('')
  const [deploymentVersionId, setDeploymentVersionId] = useState('')
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  const [hydratedProjectKey, setHydratedProjectKey] = useState<string | null>(null)
  const [lastBuild, setLastBuild] = useState<{ id: string; revisionId: string } | null>(null)
  const [preparedReleaseId, setPreparedReleaseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [publishWithDeployPending, setPublishWithDeployPending] = useState(false)
  const [preview, setPreview] = useState<{
    sessionId: string
    channelNonce: string
    previewSrc: string
    revisionId: string
  } | null>(null)

  const detail = detailQuery.data
  const project = detail?.project
  const hasDraftBindings = Boolean(
    detail?.draftActions.some(
      (action) => action.deploymentVersionId === DRAFT_DEPLOYMENT_VERSION_SENTINEL
    )
  )
  const versionsQuery = useDeploymentVersions(workflowId || null, {
    enabled: Boolean(workflowId),
  })
  const bindRevision = useBindAppRevision(appId, workspaceId)
  const buildRevision = useBuildAppRevision(appId, workspaceId)
  const prepareRelease = usePrepareAppRelease(appId, workspaceId)
  const publishRelease = usePublishAppRelease(appId, workspaceId)
  const revokeRelease = useRevokeAppRelease(appId, workspaceId)
  const rollbackRelease = useRollbackAppRelease(appId, workspaceId)
  const archiveProject = useArchiveAppProject()
  const createPreview = useCreateAppPreviewSession(appId)

  const workflowOptions = useMemo(
    () =>
      Object.values(workflowMap)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((workflow) => ({ value: workflow.id, label: workflow.name })),
    [workflowMap]
  )
  const versionOptions = useMemo(
    () =>
      (versionsQuery.data?.versions ?? []).map((version) => ({
        value: version.id,
        label: `v${version.version}${version.name ? ` · ${version.name}` : ''}${version.isActive ? ' · Live' : ''}`,
      })),
    [versionsQuery.data?.versions]
  )

  const currentAction = detail?.draftActions[0]
  const preparedRelease =
    detail?.releases.find(
      (release) =>
        release.id === preparedReleaseId ||
        (release.state === 'prepared' && release.revisionId === project?.draftRevisionId)
    ) ?? null
  const activeBuildId =
    (lastBuild && lastBuild.revisionId === project?.draftRevisionId ? lastBuild.id : null) ??
    (detail?.latestBuild?.status === 'succeeded' &&
    detail.latestBuild.revisionId === project?.draftRevisionId
      ? detail.latestBuild.id
      : null)
  const bindingDirty = hasDraftBindings
    ? false
    : !currentAction ||
      currentAction.workflowId !== workflowId ||
      currentAction.deploymentVersionId !== deploymentVersionId ||
      JSON.stringify(
        currentAction.outputAllowlist.map((output) => `${output.blockId}_${output.path}`).sort()
      ) !== JSON.stringify([...selectedOutputs].sort())
  const busy =
    bindRevision.isPending ||
    buildRevision.isPending ||
    prepareRelease.isPending ||
    publishRelease.isPending ||
    publishWithDeployPending ||
    revokeRelease.isPending ||
    rollbackRelease.isPending ||
    archiveProject.isPending ||
    createPreview.isPending

  useEffect(() => {
    setHydratedProjectKey(null)
    setLastBuild(null)
    setPreparedReleaseId(null)
    setPreview(null)
  }, [appId])

  useEffect(() => {
    if (!detail) return
    const projectKey = `${detail.project.draftRevisionId ?? 'none'}:${detail.project.version}`
    if (hydratedProjectKey === projectKey) return
    const action = detail.draftActions[0]
    if (action) {
      setWorkflowId(action.workflowId)
      setDeploymentVersionId(action.deploymentVersionId)
      setSelectedOutputs(action.outputAllowlist.map((output) => `${output.blockId}_${output.path}`))
    } else {
      setWorkflowId('')
      setDeploymentVersionId('')
      setSelectedOutputs([])
    }
    if (
      detail.latestBuild?.status === 'succeeded' &&
      detail.latestBuild.revisionId === detail.project.draftRevisionId
    ) {
      setLastBuild({
        id: detail.latestBuild.id,
        revisionId: detail.latestBuild.revisionId,
      })
    } else {
      setLastBuild(null)
    }
    const prepared = detail.releases.find(
      (release) =>
        release.state === 'prepared' && release.revisionId === detail.project.draftRevisionId
    )
    setPreparedReleaseId(prepared?.id ?? null)
    setPreview(null)
    setHydratedProjectKey(projectKey)
  }, [detail, hydratedProjectKey])

  useEffect(() => {
    if (
      preview &&
      (bindingDirty || !project?.draftRevisionId || preview.revisionId !== project.draftRevisionId)
    ) {
      setPreview(null)
    }
  }, [bindingDirty, preview, project?.draftRevisionId])

  async function saveBinding() {
    if (!workflowId || !deploymentVersionId) return
    setError(null)
    try {
      const result = await bindRevision.mutateAsync({
        actions: [
          {
            actionId: 'main',
            workflowId,
            deploymentVersionId,
            outputAllowlist: parseSelectedOutputs(selectedOutputs),
            executionPolicy: 'sync',
          },
        ],
      })
      setLastBuild(null)
      setPreparedReleaseId(null)
      setPreview(null)
      toast({ message: `Binding saved to revision ${result.revisionId.slice(0, 8)}…` })
    } catch (bindingError) {
      setError(appActionErrorMessage(bindingError, 'Failed to save workflow binding'))
    }
  }

  async function buildCurrentRevision() {
    if (!project?.draftRevisionId) return
    setError(null)
    try {
      const result = await buildRevision.mutateAsync({ revisionId: project.draftRevisionId })
      setLastBuild({ id: result.buildId, revisionId: project.draftRevisionId })
      setPreparedReleaseId(null)
      setPreview(null)
      toast({ message: result.reused ? 'Reused existing build' : 'Build completed' })
    } catch (buildError) {
      setError(appActionErrorMessage(buildError, 'Build failed'))
    }
  }

  async function prepareCurrentRelease() {
    if (!project?.draftRevisionId || !activeBuildId || bindingDirty) return
    setError(null)
    try {
      const result = await prepareRelease.mutateAsync({
        revisionId: project.draftRevisionId,
        buildId: activeBuildId,
      })
      setPreparedReleaseId(result.releaseId)
      toast({ message: 'Release prepared' })
    } catch (prepareError) {
      setError(appActionErrorMessage(prepareError, 'Failed to prepare release'))
    }
  }

  async function publishPrepared(): Promise<boolean> {
    if (!project || bindingDirty) return false
    setError(null)

    // Draft bindings always use compound publish; demo flag only gates the API route.
    if (hasDraftBindings) {
      setPublishWithDeployPending(true)
      try {
        const result = await publishAppWithDeploy({
          projectId: project.id,
          expectedVersion: project.version,
        })
        setPreparedReleaseId(null)
        setPreview(null)
        await detailQuery.refetch()
        toast({
          message: `Published with ${result.deployments.length} workflow deploy(s)`,
        })
        return true
      } catch (publishError) {
        setError(appActionErrorMessage(publishError, 'Failed to deploy and publish'))
        return false
      } finally {
        setPublishWithDeployPending(false)
      }
    }

    if (!preparedRelease) return false
    try {
      await publishRelease.mutateAsync({
        releaseId: preparedRelease.id,
        expectedVersion: project.version,
      })
      setPreparedReleaseId(null)
      toast({ message: 'App published' })
      return true
    } catch (publishError) {
      if (isApiClientError(publishError) && publishError.code === 'CONFLICT') {
        setPreparedReleaseId(null)
        await detailQuery.refetch()
        setError('Project changed concurrently. Review the latest revision and prepare again.')
        return false
      }
      setError(appActionErrorMessage(publishError, 'Failed to publish release'))
      return false
    }
  }

  async function startPreview() {
    if (!project?.draftRevisionId || !activeBuildId || bindingDirty) return
    setError(null)
    try {
      const result = await createPreview.mutateAsync({
        revisionId: project.draftRevisionId,
      })
      setPreview({
        sessionId: result.sessionId,
        channelNonce: result.channelNonce,
        previewSrc: buildAppPreviewUrl({
          appPublicOrigin: result.appPublicOrigin,
          sessionId: result.sessionId,
          channelNonce: result.channelNonce,
          parentOrigin: window.location.origin,
        }),
        revisionId: project.draftRevisionId,
      })
    } catch (previewError) {
      setError(appActionErrorMessage(previewError, 'Failed to open preview'))
    }
  }

  async function runConfirmedAction() {
    if (!project || !confirmAction) return
    setError(null)
    try {
      if (confirmAction.type === 'publish') {
        if (!(await publishPrepared())) return
      } else if (confirmAction.type === 'revoke') {
        await revokeRelease.mutateAsync({ releaseId: confirmAction.releaseId })
        toast({ message: 'Release revoked' })
      } else if (confirmAction.type === 'rollback') {
        await rollbackRelease.mutateAsync({ targetReleaseId: confirmAction.releaseId })
        toast({ message: 'Release is current' })
      } else {
        await archiveProject.mutateAsync({ projectId: appId, workspaceId })
        setConfirmAction(null)
        router.push(`/workspace/${workspaceId}/apps`)
        return
      }
      setConfirmAction(null)
    } catch (actionError) {
      setError(appActionErrorMessage(actionError, 'App action failed'))
    }
  }

  if (permissions.isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loader className='size-5' />
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className='p-8 text-[var(--text-secondary)] text-sm'>
        Workspace write permission is required to access Apps.
      </div>
    )
  }

  if (detailQuery.isLoading || workflowsLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loader className='size-5' />
      </div>
    )
  }

  if (detailQuery.isError || !detail || !project) {
    return (
      <div className='p-8 text-[var(--text-error)] text-sm'>
        {getErrorMessage(detailQuery.error, 'Failed to load app')}
      </div>
    )
  }

  const currentRelease = detail.currentRelease

  return (
    <>
      <div className='flex h-[calc(100vh-3rem)] flex-col'>
        <header className='flex items-center justify-between gap-4 border-[var(--border)] border-b px-6 py-4'>
          <div className='min-w-0'>
            <h1 className='truncate font-semibold text-[var(--text-primary)] text-xl'>
              {project.name}
            </h1>
            <p className='truncate text-[var(--text-tertiary)] text-xs'>
              /a/{project.publicId}/{project.slug}/
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <Button
              type='button'
              variant='tertiary'
              onClick={() => {
                const builderChatId = project.lastBuilderChatId || project.createdFromChatId
                router.push(
                  builderChatId
                    ? `/workspace/${workspaceId}/chat/${builderChatId}`
                    : `/workspace/${workspaceId}/home`
                )
              }}
            >
              <ArrowLeft className='size-[14px]' />
              Back to builder
            </Button>
            {detail.publicUrl ? (
              <>
                <Button
                  type='button'
                  variant='default'
                  className='gap-1.5'
                  onClick={() => {
                    void navigator.clipboard.writeText(detail.publicUrl!)
                    toast({ message: 'Public URL copied' })
                  }}
                >
                  <Copy className='size-[14px]' />
                  Copy URL
                </Button>
                <Button
                  type='button'
                  variant='default'
                  onClick={() => window.open(detail.publicUrl!, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className='size-[14px]' />
                  Open
                </Button>
              </>
            ) : null}
            <Button
              type='button'
              variant='tertiary'
              disabled={
                !canEdit ||
                busy ||
                (!preview && (!project.draftRevisionId || !activeBuildId || bindingDirty))
              }
              onClick={() => (preview ? setPreview(null) : void startPreview())}
            >
              {preview ? 'Stop preview' : createPreview.isPending ? 'Opening…' : 'Preview'}
            </Button>
          </div>
        </header>

        {error ? (
          <div
            className='border-[var(--border)] border-b bg-[var(--surface-2)] px-6 py-2 text-[var(--text-error)] text-sm'
            role='alert'
          >
            {error}
          </div>
        ) : null}

        <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,440px)_1fr]'>
          <div className='flex min-h-0 flex-col gap-5 overflow-y-auto border-[var(--border)] border-r p-5'>
            <section className='space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4'>
              <div>
                <h2 className='font-medium text-[var(--text-primary)] text-sm'>Backend binding</h2>
                <p className='mt-1 text-[var(--text-tertiary)] text-xs'>
                  {hasDraftBindings
                    ? 'Draft-bound workflows from the hosted demo. Preview runs saved drafts; publishing deploys every workflow first.'
                    : 'Select a deployed workflow version. Published releases stay pinned to that exact version.'}
                </p>
              </div>
              {hasDraftBindings ? (
                <ul className='space-y-2'>
                  {detail.draftActions.map((action) => (
                    <li
                      key={action.actionId}
                      className='rounded-md border border-[var(--border)] px-3 py-2 text-left text-xs'
                    >
                      <div className='font-medium text-[var(--text-primary)]'>
                        {action.actionId}
                      </div>
                      <div className='mt-0.5 text-[var(--text-tertiary)]'>
                        {workflowMap[action.workflowId]?.name || action.workflowId}
                        {' · '}
                        draft preview
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <div className='flex flex-col gap-1.5'>
                    <Label>Workflow</Label>
                    <ChipSelect
                      options={workflowOptions}
                      value={workflowId || undefined}
                      placeholder='Select workflow'
                      onChange={(value) => {
                        setWorkflowId(value)
                        setDeploymentVersionId('')
                        setSelectedOutputs([])
                      }}
                      disabled={!canAdmin || busy}
                    />
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <Label>Deployment version</Label>
                    <ChipSelect
                      options={versionOptions}
                      value={deploymentVersionId || undefined}
                      placeholder={workflowId ? 'Select version' : 'Select a workflow first'}
                      onChange={setDeploymentVersionId}
                      disabled={!canAdmin || !workflowId || versionsQuery.isLoading || busy}
                    />
                  </div>
                  {workflowId ? (
                    <div className='flex flex-col gap-1.5'>
                      <Label>Outputs exposed to the app</Label>
                      <OutputSelect
                        workflowId={workflowId}
                        selectedOutputs={selectedOutputs}
                        onOutputSelect={setSelectedOutputs}
                        disabled={!canAdmin || busy}
                      />
                      <p className='text-[var(--text-tertiary)] text-xs'>
                        Empty means the action returns success only.
                      </p>
                    </div>
                  ) : null}
                  <Button
                    type='button'
                    variant='tertiary'
                    disabled={
                      !canAdmin ||
                      !workflowId ||
                      !deploymentVersionId ||
                      !bindingDirty ||
                      bindRevision.isPending
                    }
                    onClick={() => void saveBinding()}
                  >
                    {bindRevision.isPending
                      ? 'Saving…'
                      : bindingDirty
                        ? 'Save binding'
                        : 'Binding saved'}
                  </Button>
                  {!canAdmin ? (
                    <p className='text-[var(--text-tertiary)] text-xs'>
                      Workspace admin permission is required to change bindings.
                    </p>
                  ) : null}
                </>
              )}
            </section>

            <section className='space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4'>
              <div>
                <h2 className='font-medium text-[var(--text-primary)] text-sm'>
                  Build and publish
                </h2>
                <p className='mt-1 text-[var(--text-tertiary)] text-xs'>
                  {hasDraftBindings
                    ? 'Publishing deploys every draft workflow, rebinds actions, rebuilds, then flips the public pointer.'
                    : 'Build the current revision, prepare an immutable release, then publish it.'}
                </p>
              </div>
              <div className='space-y-2 text-xs'>
                <div className='flex justify-between gap-3'>
                  <span className='text-[var(--text-tertiary)]'>Revision</span>
                  <span className='font-mono text-[var(--text-secondary)]'>
                    {project.draftRevisionId?.slice(0, 8) ?? 'Not bound'}
                  </span>
                </div>
                <div className='flex justify-between gap-3'>
                  <span className='text-[var(--text-tertiary)]'>Latest build</span>
                  <span className='text-[var(--text-secondary)]'>
                    {detail.latestBuild
                      ? detail.latestBuild.revisionId === project.draftRevisionId
                        ? `${detail.latestBuild.status} · ${buildModeLabel(detail.latestBuild.diagnostics.mode)}`
                        : 'Stale · rebuild current revision'
                      : 'None'}
                  </span>
                </div>
              </div>
              {hasDraftBindings ? (
                <Button
                  type='button'
                  variant='tertiary'
                  disabled={!canAdmin || !project.draftRevisionId || busy}
                  onClick={() => setConfirmAction({ type: 'publish' })}
                >
                  {publishWithDeployPending ? 'Deploying & publishing…' : 'Deploy & publish'}
                </Button>
              ) : (
                <div className='grid grid-cols-3 gap-2'>
                  <Button
                    type='button'
                    variant='default'
                    disabled={!canEdit || !project.draftRevisionId || bindingDirty || busy}
                    onClick={() => void buildCurrentRevision()}
                  >
                    {buildRevision.isPending ? 'Building…' : 'Build'}
                  </Button>
                  <Button
                    type='button'
                    variant='default'
                    disabled={
                      !canAdmin ||
                      !project.draftRevisionId ||
                      !activeBuildId ||
                      bindingDirty ||
                      busy
                    }
                    onClick={() => void prepareCurrentRelease()}
                  >
                    {prepareRelease.isPending ? 'Preparing…' : 'Prepare'}
                  </Button>
                  <Button
                    type='button'
                    variant='tertiary'
                    disabled={!canAdmin || !preparedRelease || bindingDirty || busy}
                    onClick={() => setConfirmAction({ type: 'publish' })}
                  >
                    {publishRelease.isPending ? 'Publishing…' : 'Publish'}
                  </Button>
                </div>
              )}
            </section>

            <section className='space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <h2 className='font-medium text-[var(--text-primary)] text-sm'>
                    Current release
                  </h2>
                  <p className='mt-1 text-[var(--text-tertiary)] text-xs'>
                    Only the current release is callable and retains workflow pins.
                  </p>
                </div>
                {currentRelease ? (
                  <Button
                    type='button'
                    variant='default'
                    disabled={!canAdmin || busy}
                    onClick={() =>
                      setConfirmAction({ type: 'revoke', releaseId: currentRelease.id })
                    }
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
              {currentRelease ? (
                <div className='text-[var(--text-secondary)] text-xs'>
                  <p className='font-mono'>{currentRelease.id}</p>
                  <p className='mt-1'>Published {formatDate(currentRelease.publishedAt)}</p>
                </div>
              ) : (
                <p className='text-[var(--text-tertiary)] text-sm'>No published release.</p>
              )}
            </section>

            <section className='space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4'>
              <h2 className='font-medium text-[var(--text-primary)] text-sm'>Release history</h2>
              {detail.releases.length === 0 ? (
                <p className='text-[var(--text-tertiary)] text-sm'>No releases yet.</p>
              ) : (
                <ul className='space-y-2'>
                  {detail.releases.map((release: AppRelease) => (
                    <li
                      key={release.id}
                      className='flex items-center justify-between gap-3 rounded-md bg-[var(--surface-2)] px-3 py-2'
                    >
                      <div className='min-w-0 text-xs'>
                        <p className='truncate font-mono text-[var(--text-secondary)]'>
                          {release.id.slice(0, 8)}…
                        </p>
                        <p className='text-[var(--text-tertiary)]'>
                          {release.state}
                          {release.revokedReason ? ` · ${release.revokedReason}` : ''} ·{' '}
                          {formatDate(release.createdAt)}
                        </p>
                      </div>
                      {release.state === 'revoked' &&
                      release.revokedReason === 'vacated' &&
                      project.publishedReleaseId !== release.id ? (
                        <Button
                          type='button'
                          variant='default'
                          disabled={!canAdmin || busy}
                          onClick={() =>
                            setConfirmAction({ type: 'rollback', releaseId: release.id })
                          }
                        >
                          Make current
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className='flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-4'>
              <div>
                <h2 className='font-medium text-[var(--text-primary)] text-sm'>Archive app</h2>
                <p className='mt-1 text-[var(--text-tertiary)] text-xs'>
                  Revokes the current release and removes the app from this list.
                </p>
              </div>
              <Button
                type='button'
                variant='default'
                disabled={!canAdmin || busy}
                onClick={() => setConfirmAction({ type: 'archive' })}
              >
                <Trash2 className='size-[14px]' />
                Archive
              </Button>
            </section>
          </div>

          <div className='min-h-0 bg-[var(--surface-2)]'>
            {preview ? (
              <AppPreviewBridge
                projectId={appId}
                sessionId={preview.sessionId}
                channelNonce={preview.channelNonce}
                previewSrc={preview.previewSrc}
              />
            ) : (
              <div className='flex h-full flex-col items-center justify-center gap-2 px-6 text-center'>
                <RefreshCw className='size-5 text-[var(--text-icon)]' />
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  Preview is closed
                </p>
                <p className='max-w-sm text-[var(--text-tertiary)] text-xs'>
                  Build the current revision, then open a frozen preview. Preview actions run
                  through the authenticated parent bridge.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ChipConfirmModal
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        srTitle={
          confirmAction?.type === 'archive'
            ? 'Archive app'
            : confirmAction?.type === 'publish'
              ? 'Publish app'
              : confirmAction?.type === 'rollback'
                ? 'Make release current'
                : 'Revoke release'
        }
        title={
          confirmAction?.type === 'archive'
            ? 'Archive app'
            : confirmAction?.type === 'publish'
              ? hasDraftBindings
                ? 'Deploy workflows and publish?'
                : 'Publish this release?'
              : confirmAction?.type === 'rollback'
                ? 'Make this release current?'
                : 'Revoke this release?'
        }
        text={
          confirmAction?.type === 'archive'
            ? [
                'Archive ',
                { text: project.name, bold: true },
                '? Its current release will be revoked and the public URL will show an unavailable page.',
              ]
            : confirmAction?.type === 'publish'
              ? hasDraftBindings
                ? `This deploys ${detail.draftActions.length} workflow(s), rebinds actions, rebuilds the app, then makes /a/${project.publicId}/${project.slug}/ callable.`
                : `This makes /a/${project.publicId}/${project.slug}/ callable with the prepared release.`
              : confirmAction?.type === 'rollback'
                ? 'The current release will be vacated. This historical release will be revalidated and made current.'
                : [
                    'This is a permanent kill switch for the selected release. ',
                    { text: 'Manually revoked releases cannot be reactivated.', error: true },
                  ]
        }
        confirm={{
          label:
            confirmAction?.type === 'archive'
              ? 'Archive app'
              : confirmAction?.type === 'publish'
                ? hasDraftBindings
                  ? 'Deploy & publish'
                  : 'Publish'
                : confirmAction?.type === 'rollback'
                  ? 'Make current'
                  : 'Revoke release',
          onClick: () => void runConfirmedAction(),
          pending:
            archiveProject.isPending ||
            publishRelease.isPending ||
            publishWithDeployPending ||
            revokeRelease.isPending ||
            rollbackRelease.isPending,
          pendingLabel:
            confirmAction?.type === 'archive'
              ? 'Archiving…'
              : confirmAction?.type === 'publish'
                ? hasDraftBindings
                  ? 'Deploying…'
                  : 'Publishing…'
                : confirmAction?.type === 'rollback'
                  ? 'Switching…'
                  : 'Revoking…',
        }}
      />
    </>
  )
}
