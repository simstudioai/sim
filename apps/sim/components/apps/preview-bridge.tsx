'use client'

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { requestJson } from '@/lib/api/client/request'
import { previewExecuteContract, previewHeartbeatContract } from '@/lib/api/contracts/apps'
import { APP_REQUEST_BODY_MAX_BYTES } from '@/lib/apps/manifest'

const APP_SYNC_TIMEOUT_MS = 120_000
const PREVIEW_STOP_GRACE_MS = 100
const pendingPreviewStops = new Map<string, number>()

type BridgeRequest = {
  type: 'sim.run'
  actionId: string
  input: Record<string, unknown>
  requestId: string
  nonce: string
}

type BridgeResponse = {
  type: 'sim.run.result'
  requestId: string
  nonce: string
  result: {
    success: boolean
    executionId?: string
    outputs: Record<string, unknown>
    error?: string
  }
}

interface AppPreviewBridgeProps {
  projectId: string
  sessionId: string
  channelNonce: string
  previewSrc: string
}

/**
 * Authenticated parent bridge: iframe postMessage → Sim preview API.
 * Iframe never holds a Sim session or preview token.
 */
export function AppPreviewBridge({
  projectId,
  sessionId,
  channelNonce,
  previewSrc,
}: AppPreviewBridgeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState<string | null>(null)

  const appOrigin = useMemo(() => {
    try {
      return new URL(previewSrc).origin
    } catch {
      return ''
    }
  }, [previewSrc])

  const onMessage = useEffectEvent(async (event: MessageEvent) => {
    if (!appOrigin || event.origin !== appOrigin) return
    if (event.source !== iframeRef.current?.contentWindow) return

    const data = event.data as BridgeRequest
    if (!data || data.type !== 'sim.run' || data.nonce !== channelNonce) return

    const encoded = new TextEncoder().encode(JSON.stringify(data.input || {}))
    if (encoded.length > APP_REQUEST_BODY_MAX_BYTES) {
      const response: BridgeResponse = {
        type: 'sim.run.result',
        requestId: data.requestId,
        nonce: channelNonce,
        result: { success: false, outputs: {}, error: 'Request too large' },
      }
      iframeRef.current?.contentWindow?.postMessage(response, appOrigin)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), APP_SYNC_TIMEOUT_MS)
    try {
      const result = await requestJson(previewExecuteContract, {
        params: { projectId },
        body: {
          sessionId,
          actionId: data.actionId,
          input: data.input || {},
        },
        signal: controller.signal,
      })

      const response: BridgeResponse = {
        type: 'sim.run.result',
        requestId: data.requestId,
        nonce: channelNonce,
        result: {
          success: true,
          executionId: result.executionId,
          outputs: result.outputs,
        },
      }
      iframeRef.current?.contentWindow?.postMessage(response, appOrigin)
    } catch {
      const response: BridgeResponse = {
        type: 'sim.run.result',
        requestId: data.requestId,
        nonce: channelNonce,
        result: { success: false, outputs: {}, error: 'Preview execute failed' },
      }
      iframeRef.current?.contentWindow?.postMessage(response, appOrigin)
    } finally {
      clearTimeout(timer)
    }
  })

  useEffect(() => {
    if (!appOrigin) {
      setError('Preview URL has an invalid origin')
      return
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appOrigin, onMessage])

  // Heartbeat renews preview pin TTL; stop on unmount to avoid pin leaks.
  useEffect(() => {
    if (!sessionId) return
    const pendingStop = pendingPreviewStops.get(sessionId)
    if (pendingStop !== undefined) {
      window.clearTimeout(pendingStop)
      pendingPreviewStops.delete(sessionId)
    }
    const id = window.setInterval(
      () => {
        void requestJson(previewHeartbeatContract, {
          params: { projectId },
          body: { sessionId },
        })
      },
      4 * 60 * 1000
    )
    return () => {
      window.clearInterval(id)
      // React Strict Mode performs an immediate setup → cleanup → setup replay in
      // development. Delay teardown briefly so the replay can cancel it; a real
      // unmount still stops the session and clears its pins.
      const stopTimer = window.setTimeout(() => {
        pendingPreviewStops.delete(sessionId)
        // boundary-raw-fetch: page-unload keepalive must survive component teardown
        void fetch(`/api/apps/${projectId}/preview/stop`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          keepalive: true,
        })
      }, PREVIEW_STOP_GRACE_MS)
      pendingPreviewStops.set(sessionId, stopTimer)
    }
  }, [projectId, sessionId])

  if (error) {
    return <div className='p-4 text-red-500 text-sm'>{error}</div>
  }

  // The Apps hostname is isolated from Sim cookies. Preserving its origin is
  // required for CSP `self` assets and the bridge's exact event.origin check.
  return (
    <iframe
      ref={iframeRef}
      title='App preview'
      src={previewSrc}
      className='h-full w-full border-0'
      sandbox='allow-scripts allow-forms allow-same-origin'
      referrerPolicy='no-referrer'
    />
  )
}
