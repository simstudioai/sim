'use client'

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Button, Loader } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { requestJson } from '@/lib/api/client/request'
import { previewExecuteContract, previewHeartbeatContract } from '@/lib/api/contracts/apps'
import { APP_REQUEST_BODY_MAX_BYTES } from '@/lib/apps/manifest'

const APP_SYNC_TIMEOUT_MS = 120_000
const PREVIEW_STOP_GRACE_MS = 100
const PREVIEW_DOCUMENT_LOAD_TIMEOUT_MS = 20_000
const PREVIEW_HANDSHAKE_TIMEOUT_MS = 2_000
const PREVIEW_MAX_RETRIES = 3
const pendingPreviewStops = new Map<string, number>()
const logger = createLogger('AppPreviewBridge')

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

type PreviewReadyMessage = {
  type: 'sim.preview.ready'
  nonce: string
}

type PreviewPingMessage = {
  type: 'sim.preview.ping'
  nonce: string
}

type PreviewAckMessage = {
  type: 'sim.preview.ack'
  nonce: string
}

interface AppPreviewBridgeProps {
  projectId: string
  sessionId: string
  channelNonce: string
  previewSrc: string
  onReady?: () => void
  onFailure?: (message: string) => void
  onSessionStopped?: (sessionId: string) => void
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
  onReady,
  onFailure,
  onSessionStopped,
}: AppPreviewBridgeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const readyNotificationRef = useRef<string | null>(null)
  const onReadyEvent = useEffectEvent(() => onReady?.())
  const onFailureEvent = useEffectEvent((message: string) => onFailure?.(message))
  const onSessionStoppedEvent = useEffectEvent((stoppedSessionId: string) =>
    onSessionStopped?.(stoppedSessionId)
  )

  const appOrigin = useMemo(() => {
    try {
      return new URL(previewSrc).origin
    } catch {
      return ''
    }
  }, [previewSrc])

  const iframeSrc = useMemo(() => {
    try {
      const url = new URL(previewSrc)
      if (loadAttempt > 0) {
        url.searchParams.set('__simPreviewAttempt', String(loadAttempt))
      }
      return url.toString()
    } catch {
      return previewSrc
    }
  }, [loadAttempt, previewSrc])

  const onMessage = useEffectEvent(async (event: MessageEvent) => {
    const data = event.data as Partial<BridgeRequest> | PreviewReadyMessage | null
    if (data?.type === 'sim.preview.ready') {
      const originMatch = Boolean(appOrigin) && event.origin === appOrigin
      const sourceMatch = event.source === iframeRef.current?.contentWindow
      const nonceMatch = data.nonce === channelNonce
      if (!originMatch || !sourceMatch || !nonceMatch) {
        logger.warn('Rejected preview ready handshake', {
          sessionId,
          expectedOrigin: appOrigin,
          receivedOrigin: event.origin,
          originMatch,
          sourceMatch,
          nonceMatch,
        })
        return
      }
      setReady(true)
      setLoadFailed(false)
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'sim.preview.ack', nonce: channelNonce } satisfies PreviewAckMessage,
        appOrigin
      )
      return
    }

    if (!appOrigin || event.origin !== appOrigin) return
    if (event.source !== iframeRef.current?.contentWindow) return

    if (
      !data ||
      data.type !== 'sim.run' ||
      data.nonce !== channelNonce ||
      typeof data.requestId !== 'string' ||
      data.requestId.length === 0 ||
      typeof data.actionId !== 'string' ||
      data.actionId.length === 0 ||
      typeof data.input !== 'object' ||
      data.input === null ||
      Array.isArray(data.input)
    ) {
      return
    }

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
      const message = 'Preview URL has an invalid origin'
      setError(message)
      onFailureEvent(message)
      return
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appOrigin, onMessage])

  useEffect(() => {
    setReady(false)
    setLoadAttempt(0)
    setLoadFailed(false)
    setIframeLoaded(false)
  }, [previewSrc, sessionId])

  useEffect(() => {
    if (!ready || readyNotificationRef.current === sessionId) return
    readyNotificationRef.current = sessionId
    onReadyEvent()
  }, [ready, sessionId])

  useEffect(() => {
    if (!iframeLoaded || ready || loadFailed || error || !appOrigin) return
    const ping = () =>
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'sim.preview.ping', nonce: channelNonce } satisfies PreviewPingMessage,
        appOrigin
      )
    ping()
    const id = window.setInterval(ping, 500)
    return () => window.clearInterval(id)
  }, [appOrigin, channelNonce, error, iframeLoaded, loadFailed, ready])

  // Give cold Next/Apps Host compilation time to finish before replacing the
  // iframe. Restarting a still-loading document would reset compilation work.
  useEffect(() => {
    if (iframeLoaded || ready || loadFailed || error) return
    const timer = window.setTimeout(() => {
      if (loadAttempt < PREVIEW_MAX_RETRIES) {
        setLoadAttempt((attempt) => attempt + 1)
      } else {
        setLoadFailed(true)
        logger.warn('Preview document load timed out', {
          sessionId,
          appOrigin,
          attempts: loadAttempt + 1,
        })
        onFailureEvent('The preview document did not finish loading.')
      }
    }, PREVIEW_DOCUMENT_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [appOrigin, error, iframeLoaded, loadAttempt, loadFailed, ready, sessionId])

  // Once the document has loaded, its injected bridge should answer pings
  // immediately. Only this shorter phase uses the handshake timeout.
  useEffect(() => {
    if (!iframeLoaded || ready || loadFailed || error) return
    const timer = window.setTimeout(() => {
      if (loadAttempt < PREVIEW_MAX_RETRIES) {
        setIframeLoaded(false)
        setLoadAttempt((attempt) => attempt + 1)
      } else {
        setLoadFailed(true)
        logger.warn('Preview ready handshake timed out', {
          sessionId,
          appOrigin,
          attempts: loadAttempt + 1,
        })
        onFailureEvent('The secure preview handshake timed out.')
      }
    }, PREVIEW_HANDSHAKE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [appOrigin, error, iframeLoaded, loadAttempt, loadFailed, ready, sessionId])

  // Heartbeat renews preview pin TTL; stop on unmount to avoid pin leaks.
  useEffect(() => {
    if (!sessionId) return
    const pendingStop = pendingPreviewStops.get(sessionId)
    if (pendingStop !== undefined) {
      window.clearTimeout(pendingStop)
      pendingPreviewStops.delete(sessionId)
    }
    let active = true
    const heartbeat = async () => {
      try {
        await requestJson(previewHeartbeatContract, {
          params: { projectId },
          body: { sessionId },
        })
      } catch {
        if (!active) return
        window.clearInterval(id)
        const message =
          'Preview session expired or could not be renewed. Reopen preview to continue.'
        setError(message)
        onFailureEvent(message)
      }
    }
    const id = window.setInterval(() => void heartbeat(), 4 * 60 * 1000)
    void heartbeat()
    return () => {
      active = false
      window.clearInterval(id)
      // React Strict Mode performs an immediate setup → cleanup → setup replay in
      // development. Delay teardown briefly so the replay can cancel it; a real
      // unmount still stops the session and clears its pins.
      const stopTimer = window.setTimeout(() => {
        pendingPreviewStops.delete(sessionId)
        onSessionStoppedEvent(sessionId)
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
    return (
      <div className='p-4 text-red-500 text-sm' role='alert'>
        {error}
      </div>
    )
  }

  const retryPreview = () => {
    setReady(false)
    setLoadFailed(false)
    setIframeLoaded(false)
    setLoadAttempt(0)
  }

  // The Apps hostname is isolated from Sim cookies. Preserving its origin is
  // required for CSP `self` assets and the bridge's exact event.origin check.
  return (
    <div className='relative h-full w-full'>
      <iframe
        key={loadAttempt}
        ref={iframeRef}
        title='App preview'
        src={iframeSrc}
        onLoad={() => setIframeLoaded(true)}
        className={`h-full w-full border-0 transition-opacity ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
        sandbox='allow-scripts allow-forms allow-same-origin'
        referrerPolicy='no-referrer'
      />
      {!ready ? (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--surface-2)] px-6 text-center'>
          {loadFailed ? (
            <>
              <p className='font-medium text-[var(--text-primary)] text-sm'>
                Preview could not be loaded
              </p>
              <p className='max-w-sm text-[var(--text-tertiary)] text-xs'>
                The preview loaded, but its secure parent handshake timed out. Retry without
                rebuilding your app.
              </p>
              <Button type='button' variant='default' onClick={retryPreview}>
                Retry preview
              </Button>
            </>
          ) : (
            <>
              <Loader animate className='size-5' />
              <p className='text-[var(--text-secondary)] text-sm' role='status'>
                {loadAttempt > 0
                  ? `Retrying preview (${loadAttempt}/${PREVIEW_MAX_RETRIES})…`
                  : 'Loading preview…'}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
