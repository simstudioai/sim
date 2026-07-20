/**
 * Local-mode backend: runs the Pi harness embedded in Sim with its built-in
 * tools disabled and replaced by SSH-backed file/bash tools (plus any adapted
 * Sim tools), all over a single reused SSH connection. The trusted Pi SDK and
 * provider adapter use the model credential in Sim's process; neither the model
 * context nor the target machine receives it.
 *
 * The Pi SDK is imported dynamically and externalized from the bundle, mirroring
 * how `@e2b/code-interpreter` is loaded, so the package is resolved at runtime.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createLogger } from '@sim/logger'
import type {
  PiBackendRun,
  PiLocalRunParams,
  PiRunContext,
  PiRunResult,
  PiToolSpec,
} from '@/executor/handlers/pi/backend'
import { buildPiPrompt } from '@/executor/handlers/pi/context'
import { applyPiEvent, createPiTotals, normalizePiEvent } from '@/executor/handlers/pi/events'
import { mapThinkingLevel } from '@/executor/handlers/pi/keys'
import {
  createPiModelRuntime,
  loadPiSdk,
  type PiSdk,
  resolvePiSdkModel,
} from '@/executor/handlers/pi/pi-sdk'
import {
  createScrubbedPiError,
  getScrubbedPiErrorMessage,
  scrubPiEvent,
  scrubPiSecrets,
} from '@/executor/handlers/pi/redaction'
import {
  buildSshToolSpecs,
  captureRepoChanges,
  openSshSession,
  type PiSshSession,
} from '@/executor/handlers/pi/ssh-tools'
import { getPiProviderId } from '@/providers/pi-providers'

const logger = createLogger('PiLocalBackend')

const MAX_DIFF_BYTES = 200_000

/**
 * Local mode reports the working-tree diff, so committing would hide changes
 * from `git diff HEAD`; pushing and PR creation belong to cloud mode.
 */
const LOCAL_GUIDANCE =
  'Use the provided read/write/edit/bash tools to make the file changes needed to complete the task; they ' +
  'operate on the target repository. Do not commit, push, or open a pull request — leave your changes in the ' +
  'working tree; Sim reports them after you finish.'

function isToolArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPiTool(sdk: PiSdk, spec: PiToolSpec, secrets: readonly string[]): ToolDefinition {
  return sdk.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId, params) => {
      if (!isToolArguments(params)) throw new Error('Pi tool arguments must be an object')
      const result = await spec.execute(params).catch((error) => {
        throw createScrubbedPiError(error, secrets, 'Pi tool failed')
      })
      return {
        content: [{ type: 'text', text: scrubPiSecrets(result.text, secrets) }],
        details: { isError: result.isError },
      }
    },
  })
}

async function runLocalAgent(
  sdk: PiSdk,
  session: PiSshSession,
  isolatedDir: string,
  params: PiLocalRunParams,
  context: PiRunContext,
  secrets: readonly string[]
): Promise<PiRunResult> {
  const piProviderId = getPiProviderId(params.providerId)
  const modelRuntime = await createPiModelRuntime(sdk)
  await modelRuntime.setRuntimeApiKey(piProviderId, params.apiKey)

  try {
    const thinkingLevel = mapThinkingLevel(params.thinkingLevel)
    const model = resolvePiSdkModel(modelRuntime, piProviderId, params.piModel)
    if (!model) {
      throw new Error(
        `Pi model "${params.providerId}/${params.piModel}" is not available in the installed Pi catalog`
      )
    }

    const specs = [...buildSshToolSpecs(session, params.repoPath), ...params.tools]
    const customTools = specs.map((spec) => toPiTool(sdk, spec, secrets))
    const { session: agentSession } = await sdk.createAgentSession({
      cwd: isolatedDir,
      agentDir: isolatedDir,
      model,
      thinkingLevel,
      noTools: 'builtin',
      customTools,
      modelRuntime,
      sessionManager: sdk.SessionManager.inMemory(isolatedDir),
    })

    const totals = createPiTotals()
    const unsubscribe = agentSession.subscribe((raw) => {
      const event = scrubPiEvent(normalizePiEvent(raw), secrets)
      if (!event) return
      applyPiEvent(totals, event)
      context.onEvent(event)
    })
    const onAbort = () => {
      void agentSession.abort()
    }
    if (context.signal?.aborted) onAbort()
    else context.signal?.addEventListener('abort', onAbort, { once: true })

    let runErrorMessage: string | undefined
    try {
      await agentSession.prompt(
        scrubPiSecrets(
          buildPiPrompt({
            skills: params.skills,
            initialMessages: params.initialMessages,
            task: params.task,
            guidance: LOCAL_GUIDANCE,
          }),
          secrets
        )
      )
      runErrorMessage = agentSession.agent.state.errorMessage
        ? scrubPiSecrets(agentSession.agent.state.errorMessage, secrets)
        : undefined
    } finally {
      unsubscribe()
      context.signal?.removeEventListener('abort', onAbort)
      try {
        agentSession.dispose()
      } catch (error) {
        logger.warn('Failed to dispose Pi session', {
          error: getScrubbedPiErrorMessage(error, secrets),
        })
      }
    }

    if (context.signal?.aborted) throw new Error('Pi run aborted')
    if (runErrorMessage) {
      totals.errorMessage = runErrorMessage
      return { totals }
    }

    const { changedFiles, diff } = await captureRepoChanges(
      session,
      params.repoPath,
      MAX_DIFF_BYTES
    )
    return {
      totals,
      changedFiles: changedFiles.map((file) => scrubPiSecrets(file, secrets)),
      diff: scrubPiSecrets(diff, secrets),
    }
  } finally {
    await modelRuntime.removeRuntimeApiKey(piProviderId)
  }
}

async function runLocalPiInternal(
  params: PiLocalRunParams,
  context: PiRunContext,
  secrets: readonly string[]
): Promise<PiRunResult> {
  const isolatedDir = await mkdtemp(join(tmpdir(), 'sim-pi-'))
  const session = await openSshSession(params.ssh).catch(async (error) => {
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => {})
    throw error
  })

  try {
    return await runLocalAgent(await loadPiSdk(), session, isolatedDir, params, context, secrets)
  } finally {
    session.close()
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Runs local Pi with secret redaction enforced at every host/output boundary. */
export const runLocalPi: PiBackendRun<PiLocalRunParams> = async (params, context) => {
  const secrets = [
    params.apiKey,
    params.ssh.password ?? '',
    params.ssh.privateKey ?? '',
    params.ssh.passphrase ?? '',
  ]
  try {
    return await runLocalPiInternal(params, context, secrets)
  } catch (error) {
    throw createScrubbedPiError(error, secrets)
  }
}
