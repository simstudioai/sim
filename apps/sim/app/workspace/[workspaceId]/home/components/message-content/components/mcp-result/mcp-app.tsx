'use client'

import { useEffect, useRef, useState } from 'react'
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import { Chip } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useTheme } from 'next-themes'
import type { McpPresentationResponse } from '@/lib/api/contracts/mcp-presentations'
import {
  useMcpAppResource,
  useMcpAppTool,
  useMcpPresentation,
} from '@/hooks/queries/mcp-presentations'

interface McpAppProps {
  chatId: string
  id: string
  onClose: () => void
}
interface McpAppFrameProps extends McpAppProps {
  data: McpPresentationResponse
}

function McpAppFrame({ chatId, id, data, onClose }: McpAppFrameProps) {
  const { mutateAsync: callTool } = useMcpAppTool(chatId, id)
  const { mutateAsync: readResource } = useMcpAppResource(chatId, id)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<AppBridge | null>(null)
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const themeRef = useRef<'dark' | 'light'>(theme)
  themeRef.current = theme
  const [height, setHeight] = useState(400)
  const [error, setError] = useState<string>()
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame?.contentWindow) return
    const lifecycle = new AbortController()
    const bridge = new AppBridge(
      null,
      { name: 'Sim', version: '1.0.0' },
      { serverTools: {}, serverResources: {} },
      {
        hostContext: {
          theme: themeRef.current,
          displayMode: 'inline',
          availableDisplayModes: ['inline'],
        },
      }
    )
    bridgeRef.current = bridge
    const reportError = (cause: unknown) => {
      if (!lifecycle.signal.aborted) setError(getErrorMessage(cause))
    }
    const initializationTimer = window.setTimeout(() => {
      reportError(new Error('The app did not finish opening. Close it and try again.'))
      frame.src = 'about:blank'
      lifecycle.abort()
      void bridge.close()
    }, 15_000)
    let initialized = false
    let activeRequests = 0
    const invoke = async <T,>(
      signal: AbortSignal,
      operation: (signal: AbortSignal) => Promise<T>
    ) => {
      if (activeRequests >= 4) throw new Error('Too many concurrent App requests')
      activeRequests++
      try {
        return await operation(AbortSignal.any([signal, lifecycle.signal]))
      } finally {
        activeRequests--
      }
    }
    bridge.onsandboxready = () => {
      if (lifecycle.signal.aborted) return
      void bridge
        .sendSandboxResourceReady({ html: '', sandbox: 'allow-scripts' })
        .catch(reportError)
    }
    bridge.oninitialized = () => {
      if (initialized || lifecycle.signal.aborted) return
      window.clearTimeout(initializationTimer)
      initialized = true
      void (async () => {
        await bridge.sendToolInput({ arguments: data.arguments })
        if (!lifecycle.signal.aborted) await bridge.sendToolResult(data.result)
      })().catch(reportError)
    }
    bridge.onsizechange = ({ height: nextHeight }) => {
      if (lifecycle.signal.aborted) return
      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight))
        setHeight(Math.max(160, Math.min(900, nextHeight)))
    }
    bridge.oncalltool = (params, extra) =>
      invoke(extra.signal, (signal) =>
        callTool({
          body: { name: params.name, arguments: params.arguments },
          signal,
        })
      )
    bridge.onreadresource = (params, extra) =>
      invoke(extra.signal, (signal) =>
        readResource({
          body: { uri: params.uri },
          signal,
        })
      )
    void bridge
      .connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow))
      .then(() => {
        if (!lifecycle.signal.aborted)
          frame.src = `/api/mothership/chats/${encodeURIComponent(chatId)}/mcp-results/${encodeURIComponent(id)}/frame`
      })
      .catch(reportError)
    return () => {
      bridgeRef.current = null
      lifecycle.abort()
      window.clearTimeout(initializationTimer)
      void bridge.close()
    }
  }, [chatId, id, data, callTool, readResource])

  useEffect(() => {
    bridgeRef.current?.setHostContext({
      theme,
      displayMode: 'inline',
      availableDisplayModes: ['inline'],
    })
  }, [theme])

  const close = async () => {
    if (closing) return
    setClosing(true)
    try {
      await bridgeRef.current?.teardownResource({}, { timeout: 500 })
    } catch {
      /* The view can still close when an App does not acknowledge teardown. */
    } finally {
      onClose()
    }
  }

  return (
    <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
      <div className='p-2'>
        <Chip variant='border' disabled={closing} onClick={close}>
          Close app
        </Chip>
      </div>
      {error && (
        <p className='p-3 text-[var(--text-error)] text-small' role='alert'>
          {error}
        </p>
      )}
      <iframe
        ref={frameRef}
        title={data.receipt.title}
        sandbox='allow-scripts allow-same-origin'
        referrerPolicy='no-referrer'
        className='w-full border-0'
        style={{ height }}
      />
    </div>
  )
}

export function McpApp({ chatId, id, onClose }: McpAppProps) {
  const { data, isPending, error } = useMcpPresentation(chatId, id)
  if (isPending)
    return (
      <div>
        <Chip variant='border' onClick={onClose}>
          Close app
        </Chip>
        <p className='text-[var(--text-muted)] text-small'>Opening app…</p>
      </div>
    )
  if (error)
    return (
      <div>
        <Chip variant='border' onClick={onClose}>
          Close app
        </Chip>
        <p className='text-[var(--text-error)] text-small' role='alert'>
          {getErrorMessage(error, 'Unable to open app')}
        </p>
      </div>
    )
  return <McpAppFrame chatId={chatId} id={id} data={data} onClose={onClose} />
}
