import { createHash } from 'node:crypto'
import type { Sandbox as E2BSandbox, Template as E2BTemplate } from '@e2b/code-interpreter'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  IMMUTABLE_E2B_TEMPLATE_REF_ERROR,
  immutableE2BTemplateRef,
  isImmutableE2BTemplateRef,
  isValidSandboxReleaseGeneration,
  SANDBOX_RELEASE_GENERATION_ERROR,
} from '@sim/utils/sandbox-references'
import { env } from '@/lib/core/config/env'
import { recordSandboxProviderLimit } from '@/lib/core/execution-limits/metrics'
import {
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  isNonRetryableExecutionError,
  SandboxLaunchIndeterminateError,
} from '@/lib/execution/non-retryable-error'
import { classifyInstallOutput, tailBuildLog } from '@/lib/execution/remote-sandbox/build-errors'
import {
  sandboxCliEnvironment,
  sandboxCliToolRecipes,
  sandboxCliVerificationCommand,
} from '@/lib/execution/remote-sandbox/cli-tools.server'
import {
  FUNCTION_SANDBOX_CPU_COUNT,
  FUNCTION_SANDBOX_MATERIALIZER_REVISION,
  FUNCTION_SANDBOX_MEMORY_MB,
} from '@/lib/execution/remote-sandbox/function-resources'
import {
  assertSandboxProcessOutputWithinLimit,
  isSandboxOutputLimitError,
  MAX_SANDBOX_OUTPUT_BYTES,
  MAX_SANDBOX_PROCESS_OUTPUT_BYTES,
  SandboxOutputFileError,
  SandboxOutputLimitError,
  SandboxProcessOutputBudget,
  tailStreamedSandboxOutput,
} from '@/lib/execution/remote-sandbox/output-limits'
import {
  quoteDependency,
  type SandboxSpec,
  SIM_DEPS_DIR,
  SIM_NODE_MODULES_DIR,
  systemPackageInstallCommand,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type {
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxCodeResult,
  SandboxCommandResult,
  SandboxHandle,
  SandboxImageBuild,
  SandboxImageBuilder,
  SandboxImageBuildStatus,
  SandboxImageMaterialization,
  SandboxKind,
  SandboxProvider,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('E2BSandboxProvider')

/** The `Template` callable, threaded in so the SDK stays a dynamic import. */
type TemplateFactory = typeof E2BTemplate

/**
 * Prefix for content-addressed dependency templates. Refs are account-global, so
 * the prefix keeps them clearly attributable and out of the way of hand-built
 * templates.
 */
const SANDBOX_TEMPLATE_PREFIX = 'sim-sbx-'

/**
 * How much of the spec hash goes into the ref. Template names are one namespace
 * across the whole E2B account, and nothing detects a collision — two specs
 * sharing a prefix would build to the same name and silently swap package sets
 * between workspaces. 24 hex chars (96 bits) keeps that out of reach while the
 * complete name stays within E2B's 63-character limit.
 */
const SPEC_HASH_REF_LENGTH = 24

/** Detects a generation accidentally reused with another immutable base. */
const BASE_RELEASE_REF_LENGTH = 12
const MATERIALIZER_REVISION_RADIX = 1000

/** Public provider alias used by builder/task tests and release tooling. */
export const E2B_SANDBOX_MATERIALIZER_REVISION = FUNCTION_SANDBOX_MATERIALIZER_REVISION

/** Maximum continuous sandbox lifetime supported by E2B. */
export const E2B_MAX_SANDBOX_LIFETIME_MS = 24 * 60 * 60 * 1000

const E2B_PROVIDER_LIMIT_ERROR =
  'E2B reached its 24-hour limit for a single sandbox execution. The workflow timeout may be longer, but this Function call must finish within 24 hours.'
const E2B_TIMEOUT_MESSAGE_PATTERN =
  /execution timed out|exceeding ['"]timeoutMs['"]|sandbox (?:was killed|timeout)|end of life/i
const E2B_PROVIDER_LIMIT_CLASSIFICATION_WINDOW_MS = 60_000
const E2B_COMMAND_PATH_ALIAS_PREFIX = '__SIM_E2B_COMMAND_PATH'

function e2bTimeoutMs(timeoutMs: number): number {
  return Math.min(timeoutMs, E2B_MAX_SANDBOX_LIFETIME_MS)
}

function isE2BExecutionTimeout(error: unknown): boolean {
  const name =
    error instanceof Error
      ? error.name
      : isRecordLike(error) && typeof error.name === 'string'
        ? error.name
        : ''
  const message =
    // utils-lint-allow: probes E2B's own error shape — a record-like carrying `message`
    // or `value` — which getErrorMessage cannot express.
    error instanceof Error
      ? error.message
      : isRecordLike(error)
        ? typeof error.message === 'string'
          ? error.message
          : typeof error.value === 'string'
            ? error.value
            : ''
        : ''

  return name === 'TimeoutError' && E2B_TIMEOUT_MESSAGE_PATTERN.test(message)
}

function prepareE2BCommand(
  command: string,
  envs: Record<string, string> | undefined
): { command: string; envs?: Record<string, string> } {
  if (!envs || !Object.hasOwn(envs, 'PATH')) return { command, ...(envs ? { envs } : {}) }

  let pathAlias = E2B_COMMAND_PATH_ALIAS_PREFIX
  while (Object.hasOwn(envs, pathAlias)) pathAlias += '_'

  const { PATH, ...rest } = envs
  return {
    command: `export PATH="$${pathAlias}"; unset ${pathAlias}\n${command}`,
    envs: { ...rest, [pathAlias]: PATH },
  }
}

function reachedE2BProviderLimit(
  error: unknown,
  providerLimitAtMs: number | undefined,
  signal?: AbortSignal
): boolean {
  return (
    !signal?.aborted &&
    providerLimitAtMs !== undefined &&
    Date.now() >= providerLimitAtMs - E2B_PROVIDER_LIMIT_CLASSIFICATION_WINDOW_MS &&
    isE2BExecutionTimeout(error)
  )
}

function processCodeFailure(result: SandboxCommandResult): SandboxCodeResult {
  const traceback = result.stderr || result.stdout
  const errorLine = traceback
    .split('\n')
    .reverse()
    .find((line) => /^[A-Za-z_$][\w.$]*(?:Error|Exception|Interrupt|Exit)?:\s*/.test(line.trim()))
    ?.trim()
  const separator = errorLine?.indexOf(':') ?? -1
  const parsedErrorLine = errorLine ?? ''
  const name = separator > 0 ? parsedErrorLine.slice(0, separator) : 'Error'
  const value =
    separator > 0
      ? parsedErrorLine.slice(separator + 1).trim()
      : parsedErrorLine || 'Execution failed'
  return {
    text: '',
    stdout: result.stdout,
    stderr: result.stderr,
    error: { name, value, traceback },
  }
}

function functionTemplateRef(): string {
  const templateRef = env.E2B_FUNCTION_TEMPLATE_ID
  if (!templateRef) {
    throw new Error('Function sandbox not configured (E2B_FUNCTION_TEMPLATE_ID is unset)')
  }
  if (!isImmutableE2BTemplateRef(templateRef)) {
    throw new Error(
      `Function sandbox not configured (E2B_FUNCTION_TEMPLATE_ID ${IMMUTABLE_E2B_TEMPLATE_REF_ERROR})`
    )
  }
  return templateRef
}

function functionTemplateReleaseGeneration(): number {
  const generation = env.E2B_FUNCTION_TEMPLATE_GENERATION
  if (!generation) {
    throw new Error('Function sandbox not configured (E2B_FUNCTION_TEMPLATE_GENERATION is unset)')
  }
  if (!isValidSandboxReleaseGeneration(generation)) {
    throw new Error(
      `Function sandbox not configured (E2B_FUNCTION_TEMPLATE_GENERATION ${SANDBOX_RELEASE_GENERATION_ERROR})`
    )
  }
  return Number(generation)
}

export function e2bMaterializationGeneration(
  releaseGeneration: number,
  materializerRevision = E2B_SANDBOX_MATERIALIZER_REVISION
): number {
  if (!isValidSandboxReleaseGeneration(releaseGeneration)) {
    throw new Error(`E2B Function release generation ${SANDBOX_RELEASE_GENERATION_ERROR}`)
  }
  if (
    !Number.isInteger(materializerRevision) ||
    materializerRevision < 0 ||
    materializerRevision >= MATERIALIZER_REVISION_RADIX
  ) {
    throw new Error(`E2B sandbox materializer revision must be between 0 and 999`)
  }
  return releaseGeneration * MATERIALIZER_REVISION_RADIX + materializerRevision
}

export function sandboxImageName(
  specHash: string,
  baseTemplateRef: string,
  materializationGeneration: number
): string {
  const baseRelease = createHash('sha256')
    .update(baseTemplateRef, 'utf8')
    .digest('hex')
    .slice(0, BASE_RELEASE_REF_LENGTH)
  return `${SANDBOX_TEMPLATE_PREFIX}${specHash.slice(0, SPEC_HASH_REF_LENGTH)}-g${materializationGeneration}-${baseRelease}`
}

/** Reads the active monotonic target encoded into an exact custom child reference. */
export function sandboxImageGeneration(imageRef: string): number | undefined {
  const match = imageRef.match(/-g(\d+)-[0-9a-f]+:[0-9a-f-]+$/i)
  if (!match) return undefined
  const generation = Number(match[1])
  return Number.isSafeInteger(generation) && generation > 0 ? generation : undefined
}

function currentMaterialization(specHash: string): SandboxImageMaterialization {
  const baseImageRef = functionTemplateRef()
  const generation = e2bMaterializationGeneration(functionTemplateReleaseGeneration())
  return {
    rendererRevision: E2B_SANDBOX_MATERIALIZER_REVISION,
    generation,
    imageRefPrefix: `${sandboxImageName(specHash, baseImageRef, generation)}:`,
    baseImageRef,
  }
}

/**
 * E2B's control-plane base. `ConnectionConfig` derives this internally but is
 * not re-exported by `@e2b/code-interpreter`, and `e2b` itself is only a
 * transitive dependency, so the one endpoint the SDK omits resolves it here.
 */
function e2bApiUrl(): string {
  return `https://api.${env.E2B_DOMAIN || 'e2b.app'}`
}

function templateFor(kind: SandboxKind, imageRef?: string): string {
  if (kind === 'mothership') {
    const template = env.MOTHERSHIP_E2B_TEMPLATE_ID?.trim()
    if (!template) {
      throw new Error('Mothership sandbox not configured (MOTHERSHIP_E2B_TEMPLATE_ID is unset)')
    }
    return template
  }
  if (kind === 'code' || kind === 'shell') functionTemplateReleaseGeneration()
  // A workspace dependency set may only displace the dedicated Function base.
  // Mothership, doc, Pi, and Codex keep their vetted images unconditionally, so a
  // user's package list can never land under those server-owned runtimes.
  if (imageRef && (kind === 'code' || kind === 'shell')) {
    return imageRef
  }
  // Document generation uses a dedicated template (python-pptx/docx/openpyxl/
  // reportlab + fonts); shell/code execution use the Function template.
  // Doc fails closed: never run LLM-authored Python in E2B's default template
  // (which is not vetted for this) just because the doc template id is unset.
  if (kind === 'doc') {
    if (!env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID) {
      throw new Error('Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)')
    }
    return env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID
  }
  // Pi fails closed for the same reason: the coding agent needs the Pi CLI + git
  // baked into a vetted template, never E2B's default image.
  if (kind === 'pi') {
    if (!env.E2B_PI_TEMPLATE_ID) {
      throw new Error('Pi cloud agent not configured (E2B_PI_TEMPLATE_ID is unset)')
    }
    return env.E2B_PI_TEMPLATE_ID
  }
  if (kind === 'codex') {
    if (!env.E2B_CODEX_TEMPLATE_ID) {
      throw new Error('Codex cloud agent not configured (E2B_CODEX_TEMPLATE_ID is unset)')
    }
    return env.E2B_CODEX_TEMPLATE_ID
  }
  return functionTemplateRef()
}

class E2BSandboxHandle implements SandboxHandle {
  private killed = false
  private killPromise: Promise<void> | null = null

  constructor(
    private readonly sandbox: E2BSandbox,
    private readonly language: CodeLanguage,
    private readonly providerLimitAtMs?: number
  ) {}

  get sandboxId(): string {
    return this.sandbox.sandboxId
  }

  async runCode(
    code: string,
    options: {
      timeoutMs: number
      envs?: Record<string, string>
      javascriptPreload?: string
      maxOutputBytes?: number
      signal?: AbortSignal
    }
  ): Promise<SandboxCodeResult> {
    const runId = generateShortId(12)
    const isPython = this.language === CodeLanguage.Python
    const codePath = `.sim-function-${runId}.${isPython ? 'py' : 'mjs'}`
    const preloadPath = `.sim-function-${runId}.cjs`

    try {
      await this.sandbox.files.write(codePath, code)
      if (!isPython) {
        const preload = ['global.require = require', options.javascriptPreload]
          .filter(Boolean)
          .join('\n')
        await this.sandbox.files.write(preloadPath, `${preload}\n`)
      }

      const command = isPython
        ? 'python3 "$SIM_CODE_PATH"'
        : 'set -e; if [ -n "$SIM_NODE_MODULES_PATH" ] && [ ! -e node_modules ]; then ln -s "$SIM_NODE_MODULES_PATH" node_modules; fi; node --require "$SIM_PRELOAD_PATH" "$SIM_CODE_PATH"'
      const result = await this.runCommandInternal(
        command,
        {
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          signal: options.signal,
          atMostOnce: true,
          envs: {
            ...options.envs,
            SIM_CODE_PATH: codePath,
            ...(!isPython
              ? {
                  SIM_NODE_MODULES_PATH: options.envs?.NODE_PATH ?? '',
                  SIM_PRELOAD_PATH: `./${preloadPath}`,
                }
              : {}),
          },
        },
        'code'
      )

      if (result.timedOut) {
        return { text: '', stdout: result.stdout, stderr: result.stderr, timedOut: true }
      }
      if (result.exitCode !== 0) {
        if (result.stderr === E2B_PROVIDER_LIMIT_ERROR) {
          return {
            text: '',
            stdout: result.stdout,
            stderr: result.stderr,
            error: {
              name: 'E2BProviderLimitError',
              value: E2B_PROVIDER_LIMIT_ERROR,
              traceback: E2B_PROVIDER_LIMIT_ERROR,
            },
          }
        }
        return processCodeFailure(result)
      }
      return { text: '', stdout: result.stdout, stderr: result.stderr }
    } finally {
      await this.sandbox.files.remove(codePath).catch(() => {})
      if (!isPython) await this.sandbox.files.remove(preloadPath).catch(() => {})
    }
  }

  async runCommand(command: string, options: RunCommandOptions): Promise<SandboxCommandResult> {
    return this.runCommandInternal(command, options, 'command')
  }

  private async runCommandInternal(
    command: string,
    options: RunCommandOptions,
    operation: 'code' | 'command'
  ): Promise<SandboxCommandResult> {
    const outputBudget = new SandboxProcessOutputBudget(
      options.maxOutputBytes ?? MAX_SANDBOX_PROCESS_OUTPUT_BYTES
    )
    /**
     * E2B's SDK accumulates every callback-delivered chunk in its own result strings, so all streams
     * must share the process budget even when Sim's caller consumes them incrementally. The callback
     * still receives each chunk that fits; the sandbox is stopped before later chunks can make the
     * SDK's retained copy grow without bound.
     */
    const retainStdout = options.onStdout === undefined
    const retainStderr = options.onStderr === undefined
    let observedStdout = ''
    let observedStderr = ''
    const guardOutput = (
      value: string,
      append: (chunk: string) => void,
      callback?: (chunk: string) => void
    ) => {
      try {
        outputBudget.add(value)
      } catch (error) {
        void this.kill().catch(() => {})
        throw error
      }
      append(value)
      callback?.(value)
    }
    try {
      const prepared = prepareE2BCommand(command, options.envs)
      const processOptions = {
        ...(prepared.envs ? { envs: prepared.envs } : {}),
        timeoutMs: e2bTimeoutMs(options.timeoutMs),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.rootUser ? { user: 'root' as const } : {}),
      }
      let started: Awaited<ReturnType<E2BSandbox['commands']['run']>>
      try {
        started = await this.sandbox.commands.run(prepared.command, {
          ...processOptions,
          background: true,
          onStdout: (chunk: string) =>
            guardOutput(
              chunk,
              (value) => {
                observedStdout += value
              },
              options.onStdout
            ),
          onStderr: (chunk: string) =>
            guardOutput(
              chunk,
              (value) => {
                observedStderr += value
              },
              options.onStderr
            ),
        })
      } catch (error) {
        if (options.signal?.aborted || isE2BExecutionTimeout(error)) throw error
        const failure = error as { stdout?: string; stderr?: string; exitCode?: number }
        if (
          failure.stdout !== undefined ||
          failure.stderr !== undefined ||
          failure.exitCode !== undefined
        ) {
          throw error
        }
        if (options.atMostOnce) {
          throw new SandboxLaunchIndeterminateError('E2B', { cause: error })
        }
        throw error
      }

      let result
      if ('wait' in started && typeof started.wait === 'function') {
        try {
          result = await started.wait()
        } catch (error) {
          const failure = error as { stdout?: string; stderr?: string; exitCode?: number }
          const isTerminalFailure =
            failure.stdout !== undefined ||
            failure.stderr !== undefined ||
            failure.exitCode !== undefined ||
            isE2BExecutionTimeout(error)
          if (options.signal?.aborted || outputBudget.error || isTerminalFailure) throw error
          if (options.atMostOnce) {
            throw new SandboxLaunchIndeterminateError('E2B', { cause: error })
          }

          logger.warn('E2B command event stream disconnected; reconnecting to the same process', {
            sandboxId: this.sandboxId,
            pid: started.pid,
          })
          const recovered = await this.sandbox.commands.connect(started.pid, {
            ...processOptions,
            onStdout: (chunk: string) =>
              guardOutput(
                chunk,
                (value) => {
                  observedStdout += value
                },
                options.onStdout
              ),
            onStderr: (chunk: string) =>
              guardOutput(
                chunk,
                (value) => {
                  observedStderr += value
                },
                options.onStderr
              ),
          })
          result = await recovered.wait()
        }
      } else {
        // Older test doubles return the synchronous result shape. Production E2B always returns a
        // process handle because `background: true` is fixed above.
        result = started
      }
      const mergeObservedOutput = (observed: string, returned: string): string => {
        if (!observed) return returned
        if (!returned || observed.endsWith(returned)) return observed
        if (returned.startsWith(observed)) return returned
        return observed + returned
      }
      const stdout = mergeObservedOutput(observedStdout, result.stdout ?? '')
      const stderr = mergeObservedOutput(observedStderr, result.stderr ?? '')
      assertSandboxProcessOutputWithinLimit([stdout, stderr], options.maxOutputBytes)
      return {
        stdout: retainStdout ? stdout : tailStreamedSandboxOutput(stdout),
        stderr: retainStderr ? stderr : tailStreamedSandboxOutput(stderr),
        exitCode: result.exitCode ?? 1,
      }
    } catch (error) {
      if (outputBudget.error) throw outputBudget.error
      if (isSandboxOutputLimitError(error)) throw error
      if (isNonRetryableExecutionError(error)) throw error
      if (reachedE2BProviderLimit(error, this.providerLimitAtMs, options.signal)) {
        recordSandboxProviderLimit({ provider: 'e2b', operation })
        return { stdout: '', stderr: E2B_PROVIDER_LIMIT_ERROR, exitCode: 1 }
      }
      // The SDK throws on non-zero exit; callers want the streams, not a throw.
      const failure = error as {
        stdout?: string
        stderr?: string
        message?: string
        exitCode?: number
      }
      if (
        operation === 'code' &&
        failure.stdout === undefined &&
        failure.stderr === undefined &&
        failure.exitCode === undefined &&
        !isE2BExecutionTimeout(error)
      ) {
        throw error
      }
      assertSandboxProcessOutputWithinLimit(
        [failure.stdout, failure.stderr, failure.message],
        options.maxOutputBytes
      )
      const tailIfStreamed = (value: string | undefined, retain: boolean) =>
        retain || value === undefined ? value : tailStreamedSandboxOutput(value)
      const failureStdout = tailIfStreamed(failure.stdout, retainStdout)
      const failureStderr = tailIfStreamed(failure.stderr, retainStderr)
      if (isE2BExecutionTimeout(error)) {
        return {
          stdout: failureStdout ?? '',
          stderr: failureStderr ?? failure.message ?? '',
          exitCode: 124,
          timedOut: true,
        }
      }
      return {
        stdout: failureStdout ?? '',
        stderr: failureStderr ?? failure.message ?? getErrorMessage(error),
        exitCode: failure.exitCode ?? 1,
      }
    }
  }

  readFile(path: string): Promise<string> {
    return this.readFileWithLimit(path, {
      maxBytes: MAX_SANDBOX_OUTPUT_BYTES,
      encoding: 'utf8',
    }).then(({ content }) => content)
  }

  async getFileSize(path: string): Promise<number> {
    const info = await this.sandbox.files.getInfo(path)
    if (info.type !== 'file') throw new SandboxOutputFileError(path)
    return info.size
  }

  async readFileWithLimit(
    path: string,
    options: { maxBytes: number; encoding: 'utf8' | 'base64'; signal?: AbortSignal }
  ): Promise<{ content: string; byteLength: number }> {
    const size = await this.getFileSize(path)
    if (size > options.maxBytes) {
      throw new SandboxOutputLimitError(size, options.maxBytes)
    }

    const stream = await this.sandbox.files.read(path, {
      format: 'stream',
      signal: options.signal,
      streamIdleTimeoutMs: 120_000,
    })
    try {
      const buffer = await readStreamToBufferWithLimit(stream, {
        maxBytes: options.maxBytes,
        label: 'Sandbox output file',
        signal: options.signal,
      })
      return {
        content: buffer.toString(options.encoding === 'base64' ? 'base64' : 'utf8'),
        byteLength: buffer.byteLength,
      }
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        throw new SandboxOutputLimitError(
          error.observedBytes ?? options.maxBytes + 1,
          options.maxBytes
        )
      }
      throw error
    }
  }

  async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    await this.sandbox.files.write(path, content as string)
  }

  async kill(): Promise<void> {
    if (this.killed) return
    if (!this.killPromise) {
      this.killPromise = this.sandbox
        .kill()
        .then(() => {
          this.killed = true
        })
        .finally(() => {
          if (!this.killed) this.killPromise = null
        })
    }
    await this.killPromise
  }
}

/**
 * Composes the dependency layer over the dedicated Function template. `fromTemplate`
 * means each build stacks only the new layer and inherits everything else, which
 * is what makes a template per workspace sandbox cheap.
 *
 * Dependencies reach the installer as individually quoted argv entries. The SDK
 * renders `pipInstall`/`npmInstall` by joining packages with spaces into one
 * shell string, so an unquoted `django>=5.0` would redirect stdout into a file
 * named `=5.0` and silently install an unpinned Django — hence
 * {@link quoteDependency} and the hand-composed `runCmd`.
 */
function composeDependencyTemplate(
  spec: SandboxSpec,
  template: TemplateFactory,
  baseTemplate: string
) {
  const packages = spec.dependencies.map(quoteDependency).join(' ')
  const recipes = sandboxCliToolRecipes(spec.cliTools ?? [])
  const systemPackages = spec.systemPackages ?? []
  let composed = template().fromTemplate(baseTemplate)

  if (systemPackages.length > 0) {
    composed = composed.runCmd(systemPackageInstallCommand(systemPackages), { user: 'root' })
  }
  for (const recipe of recipes) {
    composed = composed.runCmd(recipe.installCommand, { user: 'root' })
    composed = composed.runCmd(recipe.cleanupCommand, { user: 'root' })
  }
  if (recipes.length > 0) {
    composed = composed.setEnvs(sandboxCliEnvironment(spec.cliTools ?? []))
    for (const recipe of recipes) {
      composed = composed.runCmd(sandboxCliVerificationCommand(recipe, spec.cliTools), {
        user: 'root',
      })
    }
  }

  if (spec.language === CodeLanguage.Python) {
    return packages
      ? composed.runCmd(`pip install --no-input --disable-pip-version-check ${packages}`, {
          user: 'root',
        })
      : composed
  }

  // Unlike pip, an npm install is not automatically importable — Node resolves
  // from NODE_PATH or the install location. Installing into a fixed prefix and
  // baking NODE_PATH is what makes `require`/`import` find these packages.
  composed = composed.setEnvs({
    ...(recipes.length > 0 ? sandboxCliEnvironment(spec.cliTools ?? []) : {}),
    NODE_PATH: SIM_NODE_MODULES_DIR,
  })
  return packages
    ? composed
        .makeDir(SIM_DEPS_DIR, { user: 'root' })
        .runCmd(
          `npm install --prefix ${SIM_DEPS_DIR} --no-audit --no-fund --omit=dev ${packages}`,
          { user: 'root' }
        )
    : composed
}

const e2bImages: SandboxImageBuilder = {
  rendererRevision: E2B_SANDBOX_MATERIALIZER_REVISION,

  materialization(specHash: string): SandboxImageMaterialization {
    return currentMaterialization(specHash)
  },

  imageRefGeneration(imageRef: string): number | undefined {
    return sandboxImageGeneration(imageRef)
  },

  async startBuild(
    spec: SandboxSpec,
    specHash: string,
    materialization: SandboxImageMaterialization
  ): Promise<SandboxImageBuild> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required to build a sandbox image')
    }
    if (materialization.rendererRevision !== E2B_SANDBOX_MATERIALIZER_REVISION) {
      throw new Error(
        'Sandbox image materialization payload uses an incompatible renderer revision'
      )
    }
    if (!Number.isSafeInteger(materialization.generation) || materialization.generation <= 0) {
      throw new Error('Sandbox image materialization payload has an invalid generation')
    }
    if (!isImmutableE2BTemplateRef(materialization.baseImageRef)) {
      throw new Error(`Sandbox image materialization base ${IMMUTABLE_E2B_TEMPLATE_REF_ERROR}`)
    }
    const imageName = sandboxImageName(
      specHash,
      materialization.baseImageRef,
      materialization.generation
    )
    if (`${imageName}:` !== materialization.imageRefPrefix) {
      throw new Error('Sandbox image materialization payload does not match its immutable base')
    }

    const { Template } = await import('@e2b/code-interpreter')
    const template = composeDependencyTemplate(spec, Template, materialization.baseImageRef)
    const build = await Template.buildInBackground(template, imageName, {
      apiKey,
      cpuCount: FUNCTION_SANDBOX_CPU_COUNT,
      memoryMB: FUNCTION_SANDBOX_MEMORY_MB,
    })
    const imageRef = immutableE2BTemplateRef(imageName, build.buildId)

    logger.info('Started E2B sandbox image build', {
      imageRef,
      buildId: build.buildId,
      language: spec.language,
      dependencyCount: spec.dependencies.length,
      cliToolCount: spec.cliTools?.length ?? 0,
      systemPackageCount: spec.systemPackages?.length ?? 0,
    })
    return { imageRef, buildId: build.buildId, providerImageId: build.templateId }
  },

  async getBuildStatus(
    build: SandboxImageBuild,
    spec: SandboxSpec
  ): Promise<SandboxImageBuildStatus> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required to poll a sandbox image build')
    }
    const { Template } = await import('@e2b/code-interpreter')
    const status = await Template.getBuildStatus(
      { templateId: build.providerImageId ?? build.imageRef, buildId: build.buildId },
      { apiKey }
    )

    const logs = status.logEntries.map((entry) => entry.message).join('\n')
    if (status.status === 'ready') return { status: 'ready' }
    if (status.status === 'error') {
      return {
        status: 'failed',
        error: classifyInstallOutput(spec.language, `${status.reason?.message ?? ''}\n${logs}`),
        logs: tailBuildLog(logs),
      }
    }
    return { status: 'building' }
  },

  /**
   * E2B maps a 404 from the control plane to `NotFoundError`, and the only resource
   * a create request names is the template — so a 404 there means the ref is gone.
   *
   * Its two subclasses are excluded because they describe other calls entirely: a
   * missing file inside a running sandbox, or a sandbox that has already exited.
   * Neither is reachable from a create. Everything else — auth, rate limit,
   * transport — is deliberately not a missing image, since rebuilding on those
   * would turn a provider outage into a build storm.
   */
  async isMissingImage(error: unknown): Promise<boolean> {
    const { FileNotFoundError, NotFoundError, SandboxNotFoundError } = await import(
      '@e2b/code-interpreter'
    )
    return (
      error instanceof NotFoundError &&
      !(error instanceof SandboxNotFoundError) &&
      !(error instanceof FileNotFoundError)
    )
  },

  /**
   * The SDK surfaces no template delete, so the retention sweep calls the REST
   * endpoint directly. A non-2xx throws so the caller leaves the registry row in
   * place and retries, rather than orphaning the remote template.
   */
  async deleteImage(build: SandboxImageBuild): Promise<void> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required to delete a sandbox image')
    }
    const templateId = build.providerImageId ?? build.imageRef
    const response = await fetch(`${e2bApiUrl()}/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
      headers: { 'X-API-KEY': apiKey },
      // The retention sweep deletes sequentially; without this one hung
      // connection to the control plane stalls the whole cron handler.
      signal: AbortSignal.timeout(30_000),
    })
    // A template that is already gone is the state we wanted.
    if (!response.ok && response.status !== 404) {
      throw new Error(`E2B refused to delete template ${templateId} (${response.status})`)
    }
  },
}

export const e2bProvider: SandboxProvider = {
  id: 'e2b',
  dependencyStrategy: 'prebuilt',
  images: e2bImages,
  async create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required when E2B is enabled')
    }
    const templateName = templateFor(kind, options?.imageRef)
    logger.info('Creating E2B sandbox', { kind, template: templateName })

    // E2B reaps a sandbox after `timeoutMs` (default five minutes). Omitted
    // unless a caller asked for a lifetime, so the short-lived code/doc/shell
    // kinds keep the SDK default.
    //
    // Tested against `undefined` rather than truthiness: a caller that derives
    // the lifetime from an execution deadline can legitimately arrive at zero,
    // and treating that as "unset" would hand an expired run the five-minute
    // default — longer than the lifetime it asked for, which is the opposite of
    // what it requested.
    const effectiveLifetimeMs =
      options?.lifetimeMs !== undefined ? e2bTimeoutMs(options.lifetimeMs) : undefined
    const createOptions = {
      apiKey,
      ...(effectiveLifetimeMs !== undefined ? { timeoutMs: effectiveLifetimeMs } : {}),
    }

    const { Sandbox } = await import('@e2b/code-interpreter')
    const lifetimeStartedAtMs = Date.now()
    const sandbox = await Sandbox.create(templateName, createOptions)

    return new E2BSandboxHandle(
      sandbox,
      options?.language ?? CodeLanguage.Python,
      effectiveLifetimeMs === E2B_MAX_SANDBOX_LIFETIME_MS
        ? lifetimeStartedAtMs + E2B_MAX_SANDBOX_LIFETIME_MS
        : undefined
    )
  },
}
