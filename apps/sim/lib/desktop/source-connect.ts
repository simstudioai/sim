import type { DesktopOAuthConnectResult } from '@sim/desktop-bridge'
import { toast } from '@sim/emcn'
import { toError } from '@sim/utils/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  createDesktopSourceRequestContract,
  type DesktopSourceRequest,
} from '@/lib/api/contracts/desktop-source-connect'
import { getDesktopBridge } from '@/lib/desktop'

const CONNECTION_TIMEOUT_MS = 10 * 60_000

/** Runs source authorization in the system browser without navigating the desktop renderer. */
export async function connectDesktopSource(
  request: DesktopSourceRequest,
  signal?: AbortSignal
): Promise<DesktopOAuthConnectResult> {
  const bridge = getDesktopBridge()
  if (!bridge?.prepareSourceConnect || !bridge.beginSourceConnect || !bridge.cancelSourceConnect) {
    throw new Error('Update the Sim desktop app to connect this account.')
  }
  signal?.throwIfAborted()
  const requestId = await bridge.prepareSourceConnect()
  if (!requestId) throw new Error('Could not start the connection. Try connecting again.')
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let settled = false
    const finish = (result?: DesktopOAuthConnectResult, error?: Error) => {
      if (settled) return
      settled = true
      controller.abort()
      clearTimeout(timer)
      unsubscribe()
      toast.dismiss(notice)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else if (result?.ok) resolve(result)
      else
        reject(
          new Error(
            result?.error === 'cancelled' || result?.error === 'superseded'
              ? 'Connection canceled. You can try again.'
              : result?.error === 'signin_required'
                ? 'Sign in to Sim in your browser, then try connecting again.'
                : 'Connection did not complete. Try connecting again.'
          )
        )
    }
    const abort = () => {
      void bridge.cancelSourceConnect?.(requestId).catch(() => undefined)
      finish(undefined, new Error('Connection canceled. You can try again.'))
    }
    const unsubscribe = bridge.onOAuthConnectComplete((result) => {
      if (result.sourceRequestId === requestId) finish(result)
    })
    const timer = setTimeout(() => {
      void bridge.cancelSourceConnect?.(requestId).catch(() => undefined)
      finish(undefined, new Error('Connection timed out. Try connecting again.'))
    }, CONNECTION_TIMEOUT_MS)
    const notice = toast({
      message: 'Continue connecting in your browser',
      duration: 0,
      persistAcrossRoutes: true,
      action: { label: 'Cancel', onClick: abort },
      onUserDismiss: abort,
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    void requestJson(createDesktopSourceRequestContract, {
      body: { requestId, request },
      signal: controller.signal,
    })
      .then(async () => {
        if (settled) return
        const opened = await bridge.beginSourceConnect!(requestId)
        if (!opened)
          finish(undefined, new Error('Could not open the browser. Try connecting again.'))
      })
      .catch((error) => {
        void bridge.cancelSourceConnect?.(requestId).catch(() => undefined)
        finish(undefined, toError(error))
      })
  })
}
