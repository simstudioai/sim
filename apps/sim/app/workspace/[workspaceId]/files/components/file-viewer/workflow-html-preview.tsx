'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { useTheme } from 'next-themes'
import {
  SIM_ARTIFACT_SHELL,
  SIM_ARTIFACT_STYLESHEET,
  simTokenOverrides,
  usesSimArtifactStyles,
} from '@/lib/workspace-files/artifact-stylesheet'
import { compileSimPage, isSimPageSource } from '@/lib/workspace-files/page-compile'
import { fileWorkflowInputSchema } from '@/lib/workspace-files/workflows/types'
import {
  type FileWorkflowTarget,
  useFileWorkflowRequest,
  useFileWorkflowResults,
  useHtmlRuntime,
} from '@/hooks/queries/file-workflows'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { useStreamBatchedValue } from '@/hooks/use-stream-batched-value'

interface WorkflowHtmlPreviewProps {
  content: string
  workspaceId: string
  fileId: string
  fileKey: string
  workflowIds: string[]
  isStreaming?: boolean
}

function buildWorkflowDocument(content: string, dark: boolean) {
  const html = isSimPageSource(content) ? compileSimPage(content) : content
  const styles = usesSimArtifactStyles(html)
    ? `<style>${SIM_ARTIFACT_STYLESHEET}</style><style>${simTokenOverrides(dark ? 'dark' : 'light')}</style>${SIM_ARTIFACT_SHELL}`
    : ''
  return /<head[\s>]/i.test(html)
    ? html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${styles}`)
    : `${styles}${html}`
}

/** The remount key binds the port to exactly one document and its saved workflow configuration. */
export function WorkflowHtmlPreview(props: WorkflowHtmlPreviewProps) {
  const { resolvedTheme } = useTheme()
  const content = useStreamBatchedValue(props.content, props.isStreaming === true, 2000)
  const needsRenderedSource = !props.isStreaming && isSimPageSource(props.content)
  const served = useWorkspaceFileBinary(props.workspaceId, props.fileId, props.fileKey, {
    enabled: needsRenderedSource,
  })
  if (needsRenderedSource && served.error)
    return (
      <div role='alert' className='p-4 text-[var(--text-error)]'>
        {served.error.message}
      </div>
    )
  if (needsRenderedSource && !served.data)
    return <div className='p-4 text-[var(--text-muted)]'>Loading document…</div>
  const html = buildWorkflowDocument(
    served.data && needsRenderedSource ? new TextDecoder().decode(served.data) : content,
    resolvedTheme === 'dark'
  )
  return (
    <WorkflowHtmlFrame
      key={`${props.fileKey}:${JSON.stringify(props.workflowIds)}:${html}`}
      {...props}
      html={html}
    />
  )
}

function WorkflowHtmlFrame({
  html,
  workspaceId,
  fileId,
  workflowIds,
}: WorkflowHtmlPreviewProps & { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const port = useRef<MessagePort | null>(null)
  const source = useFileContentSource()
  const target = useMemo<FileWorkflowTarget>(
    () =>
      source.workflowShareToken
        ? { kind: 'public', token: source.workflowShareToken }
        : { kind: 'private', workspaceId, fileId },
    [source.workflowShareToken, workspaceId, fileId]
  )
  const runtime = useHtmlRuntime()
  const results = useFileWorkflowResults(target, workflowIds)
  const latestResults = useRef(results.data)
  latestResults.current = results.data
  const { mutateAsync: request } = useFileWorkflowRequest(target)
  const frameUrl = runtime.data?.frameUrl
  const workflowIdKey = JSON.stringify(workflowIds)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const failed = Boolean(results.error || runtime.error || bridgeError)

  useEffect(() => {
    if (!frameUrl || failed) return
    let active = true
    let initialized = false
    let pending = 0
    const timeout = setTimeout(
      () => setBridgeError('Could not load the document. Reload the file to try again.'),
      15000
    )
    const allowedIds = new Set(JSON.parse(workflowIdKey) as string[])
    const receive = (event: MessageEvent) => {
      if (
        !active ||
        initialized ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        !isRecordLike(event.data) ||
        event.data.type !== 'sim:html:ready'
      )
        return
      initialized = true
      clearTimeout(timeout)
      const channel = new MessageChannel()
      port.current = channel.port1
      channel.port1.onmessage = async ({ data }: MessageEvent<unknown>) => {
        if (
          !active ||
          !isRecordLike(data) ||
          data.type !== 'sim:workflow:request' ||
          typeof data.requestId !== 'number' ||
          !Number.isSafeInteger(data.requestId) ||
          typeof data.workflowId !== 'string' ||
          (data.method !== 'run' && data.method !== 'read')
        )
          return
        const respond = (value: object) => {
          if (active)
            channel.port1.postMessage({
              type: 'sim:workflow:response',
              requestId: data.requestId,
              ...value,
            })
        }
        if (!allowedIds.has(data.workflowId)) {
          respond({ error: 'This workflow is not configured for the file' })
          return
        }
        const input = fileWorkflowInputSchema.safeParse(data.input === undefined ? {} : data.input)
        if (!input.success) {
          respond({ error: 'Workflow input must be a JSON object' })
          return
        }
        if (pending >= 8) {
          respond({ error: 'Too many pending workflow calls' })
          return
        }
        pending++
        try {
          respond({
            result: await request({
              method: data.method,
              workflowId: data.workflowId,
              input: input.data,
            }),
          })
        } catch (error) {
          respond({ error: getErrorMessage(error, 'Workflow request failed') })
        } finally {
          pending--
        }
      }
      channel.port1.start()
      /** Opaque sandbox origins require '*'; event.source and the one-time handshake bind the frame. */
      frame.current?.contentWindow?.postMessage({ type: 'sim:html:init', html }, '*', [
        channel.port2,
      ])
      for (const entry of latestResults.current ?? []) {
        channel.port1.postMessage({ type: 'sim:workflow:changed', ...entry })
      }
    }
    window.addEventListener('message', receive)
    return () => {
      active = false
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
      port.current?.close()
      port.current = null
    }
  }, [frameUrl, html, request, workflowIdKey, failed])

  useEffect(() => {
    for (const entry of results.data ?? [])
      port.current?.postMessage({ type: 'sim:workflow:changed', ...entry })
  }, [results.data])

  if (bridgeError)
    return (
      <div role='alert' className='p-4 text-[var(--text-error)]'>
        {bridgeError}
      </div>
    )

  if (results.error)
    return (
      <div role='alert' className='p-4 text-[var(--text-error)]'>
        {results.error.message}
      </div>
    )
  if (runtime.error)
    return (
      <div role='alert' className='p-4 text-[var(--text-error)]'>
        {runtime.error.message}
      </div>
    )
  if (!frameUrl) return <div className='p-4 text-[var(--text-muted)]'>Loading document…</div>
  return (
    <iframe
      ref={frame}
      src={frameUrl}
      sandbox='allow-scripts'
      referrerPolicy='no-referrer'
      title='HTML Preview'
      className='min-h-0 w-full flex-1 border-0 bg-[var(--surface-2)]'
    />
  )
}
