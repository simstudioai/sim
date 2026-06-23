/**
 * Local-mode backend: runs the Pi harness embedded in Sim with its built-in
 * tools disabled and replaced by SSH-backed file/bash tools (plus any adapted
 * Sim tools), all over a single reused SSH connection. The provider key stays in
 * Sim's process (injected via `authStorage.setRuntimeApiKey`); only file/bash
 * operations cross to the target machine.
 *
 * The Pi SDK is imported dynamically and externalized from the bundle, mirroring
 * how `@e2b/code-interpreter` is loaded, so the package is resolved at runtime.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelRegistry, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createLogger } from '@sim/logger'
import type { PiBackendRun, PiLocalRunParams, PiToolSpec } from '@/executor/handlers/pi/backend'
import { buildPiPrompt } from '@/executor/handlers/pi/context'
import { applyPiEvent, createPiTotals, normalizePiEvent } from '@/executor/handlers/pi/events'
import { mapThinkingLevel } from '@/executor/handlers/pi/keys'
import {
  buildSshToolSpecs,
  captureRepoChanges,
  openSshSession,
} from '@/executor/handlers/pi/ssh-tools'

const logger = createLogger('PiLocalBackend')

const MAX_DIFF_BYTES = 200_000

// Local mode edits in place and reports the working-tree diff. The agent must not
// commit (a commit would hide the changes from `git diff HEAD`) or push/open a PR.
const LOCAL_GUIDANCE =
  'Use the provided read/write/edit/bash tools to make the file changes needed to complete the task; they ' +
  'operate on the target repository. Do not commit, push, or open a pull request — leave your changes in the ' +
  'working tree; Sim reports them after you finish.'

/** The Pi SDK module, loaded dynamically so it stays externalized from the bundle. */
type PiSdk = typeof import('@earendil-works/pi-coding-agent')

let sdkPromise: Promise<PiSdk> | undefined

function loadPiSdk(): Promise<PiSdk> {
  if (!sdkPromise) {
    // A static specifier (not a variable) is required so Next's dependency tracer
    // copies the package + its transitive deps into the standalone Docker output,
    // the same way `@e2b/code-interpreter` is handled. Clear the cache on failure
    // so a transient import error doesn't permanently break later local runs.
    sdkPromise = import('@earendil-works/pi-coding-agent').catch((error) => {
      sdkPromise = undefined
      throw error
    })
  }
  return sdkPromise
}

function toPiTool(sdk: PiSdk, spec: PiToolSpec): ToolDefinition {
  return sdk.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    // double-cast-allowed: Pi accepts a plain JSON Schema at runtime (pi-ai validation.js coerceWithJsonSchema); the static type requires a TypeBox TSchema
    parameters: spec.parameters as unknown as ToolDefinition['parameters'],
    execute: async (_toolCallId, params) => {
      const result = await spec.execute(params as Record<string, unknown>)
      return {
        content: [{ type: 'text', text: result.text }],
        details: { isError: result.isError },
      }
    },
  })
}

/**
 * Builds a model definition for a provider Pi supports but whose bundled catalog
 * doesn't list this exact id (e.g. a newer model Pi wires to a different
 * provider). Mirrors the cloud CLI's passthrough: clone one of the provider's
 * models as a template, swap in the requested id, and force reasoning when a
 * thinking level is requested. Returns undefined only when the provider has no
 * models at all, so even passthrough can't route it.
 */
function buildPiFallbackModel(
  modelRegistry: ModelRegistry,
  provider: string,
  modelId: string,
  thinkingLevel: ReturnType<typeof mapThinkingLevel>
) {
  const providerModels = modelRegistry.getAll().filter((m) => m.provider === provider)
  if (providerModels.length === 0) return undefined
  const fallback = { ...providerModels[0], id: modelId, name: modelId }
  return thinkingLevel && thinkingLevel !== 'off' ? { ...fallback, reasoning: true } : fallback
}

export const runLocalPi: PiBackendRun<PiLocalRunParams> = async (params, context) => {
  // Isolate Pi resource discovery: an empty cwd/agentDir keeps DefaultResourceLoader
  // from loading the Sim server's own .agents/skills, AGENTS.md, extensions, or settings.
  const isolatedDir = await mkdtemp(join(tmpdir(), 'sim-pi-'))
  // Clean up the scratch dir if the SSH connection fails — the try/finally below
  // is only entered once the session is open, so an early handshake failure would
  // otherwise orphan the directory.
  const session = await openSshSession(params.ssh).catch(async (error) => {
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => {})
    throw error
  })

  try {
    const sdk = await loadPiSdk()

    const authStorage = sdk.AuthStorage.create()
    authStorage.setRuntimeApiKey(params.providerId, params.apiKey)

    const modelRegistry = sdk.ModelRegistry.create(authStorage)
    const thinkingLevel = mapThinkingLevel(params.thinkingLevel)
    // Parity with cloud: when the model isn't in Pi's bundled catalog under the
    // resolved provider, pass it through on that provider instead of failing.
    const model =
      modelRegistry.find(params.providerId, params.model) ??
      buildPiFallbackModel(modelRegistry, params.providerId, params.model, thinkingLevel)
    if (!model) {
      throw new Error(
        `Pi has no models for provider "${params.providerId}" (cannot run ${params.model})`
      )
    }

    const specs = [...buildSshToolSpecs(session, params.repoPath), ...params.tools]
    const customTools = specs.map((spec) => toPiTool(sdk, spec))

    const { session: agentSession } = await sdk.createAgentSession({
      cwd: isolatedDir,
      agentDir: isolatedDir,
      model,
      thinkingLevel,
      noTools: 'builtin',
      customTools,
      authStorage,
      modelRegistry,
      sessionManager: sdk.SessionManager.inMemory(isolatedDir),
    })

    const totals = createPiTotals()
    const unsubscribe = agentSession.subscribe((raw) => {
      const event = normalizePiEvent(raw)
      if (!event) return
      applyPiEvent(totals, event)
      context.onEvent(event)
    })

    const onAbort = () => {
      void agentSession.abort()
    }
    if (context.signal?.aborted) {
      onAbort()
    } else {
      context.signal?.addEventListener('abort', onAbort, { once: true })
    }

    let runErrorMessage: string | undefined
    try {
      await agentSession.prompt(
        buildPiPrompt({
          skills: params.skills,
          initialMessages: params.initialMessages,
          task: params.task,
          guidance: LOCAL_GUIDANCE,
        })
      )
      // Pi has no error event; a failed run surfaces on the agent state. Capture
      // it before `dispose()` so the failure can't be missed by a later read.
      runErrorMessage = agentSession.agent.state.errorMessage
    } finally {
      unsubscribe()
      context.signal?.removeEventListener('abort', onAbort)
      try {
        agentSession.dispose()
      } catch (error) {
        logger.warn('Failed to dispose Pi session', { error })
      }
    }

    // Aborts propagate as errors so a cancelled/timed-out run is not reported as
    // success and no partial memory turn is persisted (cloud mode mirrors this).
    // Pi resolves `prompt()` on abort rather than rejecting, so check explicitly.
    if (context.signal?.aborted) {
      throw new Error('Pi run aborted')
    }

    if (runErrorMessage) {
      totals.errorMessage = runErrorMessage
      return { totals }
    }

    // Local mode edits in place (no PR), so report what changed via the repo's
    // working-tree diff over the same SSH session.
    const { changedFiles, diff } = await captureRepoChanges(
      session,
      params.repoPath,
      MAX_DIFF_BYTES
    )
    return { totals, changedFiles, diff }
  } finally {
    session.close()
    await rm(isolatedDir, { recursive: true, force: true }).catch(() => {})
  }
}
