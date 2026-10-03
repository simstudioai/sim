import type { Stagehand as StagehandType } from '@browserbasehq/stagehand'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const logger = createLogger('StagehandClient')

export interface StagehandSession {
  stagehand: StagehandType
  run<T>(operation: Promise<T>): Promise<T>
  close(): Promise<void>
}

export function hasBrowserbaseConfiguration(): boolean {
  return Boolean(env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID)
}

export function getBrowserbaseApiKey(): string | undefined {
  return env.BROWSERBASE_API_KEY
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return operation
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      finish(() => reject(toError(signal.reason ?? new Error('Aborted'))))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })
}

export async function createStagehandSession({
  provider,
  apiKey,
  disableApi,
  signal,
}: {
  provider: 'openai' | 'anthropic'
  apiKey: string
  disableApi: boolean
  signal?: AbortSignal
}): Promise<StagehandSession> {
  signal?.throwIfAborted()
  const browserbaseApiKey = env.BROWSERBASE_API_KEY
  const projectId = env.BROWSERBASE_PROJECT_ID
  if (!browserbaseApiKey || !projectId) {
    throw new Error('Server configuration error: Missing required environment variables')
  }
  const modelName = provider === 'anthropic' ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-5'
  const { Stagehand } = await import('@browserbasehq/stagehand')
  signal?.throwIfAborted()
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: browserbaseApiKey,
    projectId,
    verbose: 1,
    ...(disableApi ? { disableAPI: true } : {}),
    logger: (message) =>
      logger.info(typeof message === 'string' ? message : JSON.stringify(message)),
    model: { modelName, apiKey },
  })
  let closePromise: Promise<void> | undefined
  const closeInstance = () => {
    closePromise ??= stagehand.close().catch((error) => {
      logger.error('Error closing Stagehand instance', { error })
    })
    return closePromise
  }
  const onAbort = () => void closeInstance()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await abortable(stagehand.init(), signal)
  } catch (error) {
    signal?.removeEventListener('abort', onAbort)
    await closeInstance()
    throw error
  }

  return {
    stagehand,
    run: <T>(operation: Promise<T>) => abortable(operation, signal),
    close: async () => {
      signal?.removeEventListener('abort', onAbort)
      await closeInstance()
    },
  }
}
