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
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createLogger } from '@sim/logger'
import type { PiBackendRun, PiLocalRunParams, PiToolSpec } from '@/executor/handlers/pi/backend'
import { buildPiPrompt } from '@/executor/handlers/pi/context'
import { applyPiEvent, createPiTotals, normalizePiEvent } from '@/executor/handlers/pi/events'
import { mapThinkingLevel } from '@/executor/handlers/pi/keys'
import { loadPiSdk, type PiSdk, resolvePiSdkModel } from '@/executor/handlers/pi/pi-sdk'
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

function isToolArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toPiTool(sdk: PiSdk, spec: PiToolSpec): ToolDefinition {
  return sdk.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId, params) => {
      if (!isToolArguments(params)) throw new Error('Pi tool arguments must be an object')
      const result = await spec.execute(params)
      return {
        content: [{ type: 'text', text: result.text }],
        details: { isError: result.isError },
      }
    },
  })
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

    const authStorage = sdk.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(params.providerId, params.apiKey)

    const modelRegistry = sdk.ModelRegistry.inMemory(authStorage)
    const thinkingLevel = mapThinkingLevel(params.thinkingLevel)
    const model = resolvePiSdkModel(modelRegistry, params.providerId, params.piModel)
    if (!model) {
      throw new Error(
        `Pi model "${params.providerId}/${params.piModel}" is not available in the installed Pi catalog`
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
