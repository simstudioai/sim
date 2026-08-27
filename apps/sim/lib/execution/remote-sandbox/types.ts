import type { CodePlaceholderRuntimeBinding } from '@/lib/execution/code-placeholders/types'
import type { CodeLanguage } from '@/lib/execution/languages'
import type { SandboxBuildError } from '@/lib/execution/remote-sandbox/build-errors'
import type { SandboxSpec } from '@/lib/execution/remote-sandbox/sandbox-spec'

/**
 * Which vetted image a sandbox runs in. Every kind fails closed when its
 * template/snapshot id is unset, so LLM-authored code can never land in a
 * provider's unvetted default image.
 */
export type SandboxKind = 'code' | 'shell' | 'mothership' | 'doc' | 'pi'

export type SandboxProviderId = 'e2b' | 'daytona'

/**
 * A sandbox input file. `content` entries are written inline; `url` entries are fetched from inside
 * the sandbox (so large mounts never pass their bytes through the web process).
 */
export type SandboxFile =
  | { type?: 'content'; path: string; content: string; encoding?: 'base64' }
  | { type: 'url'; path: string; url: string }

/**
 * An internal runtime payload materialized at an opaque sandbox path.
 * Only the generated path is exposed to executed code through the requested
 * environment variable; the content never passes through a command or source.
 */
export interface SandboxPrivateInput {
  environmentVariable: string
  content: string | ArrayBuffer
}

export interface SandboxExecutionRequest {
  code: string
  language: CodeLanguage
  timeoutMs: number
  sandboxFiles?: SandboxFile[]
  privateInputs?: SandboxPrivateInput[]
  /** Compiler-owned runtime descriptors installed before JavaScript and its static imports. */
  runtimeBindings?: CodePlaceholderRuntimeBinding[]
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
  /**
   * Which sandbox image to run in. Defaults to 'code' (the Function base).
   * Trusted Mothership calls pass 'mothership'; workspace callers cannot select it.
   * Document generation passes 'doc' so it runs in the doc image
   * (mothership-docs) that has python-pptx/docx/openpyxl/reportlab installed.
   */
  sandboxKind?: 'code' | 'mothership' | 'doc'
  /** Scope for {@link sandboxId}; a sandbox from another workspace is rejected. */
  workspaceId?: string
  /** Workspace sandbox whose dependency set this execution runs against. */
  sandboxId?: string
  /** Cancels the provider sandbox when the caller's execution budget expires. */
  signal?: AbortSignal
}

export interface SandboxShellExecutionRequest {
  code: string
  envs: Record<string, string>
  timeoutMs: number
  sandboxFiles?: SandboxFile[]
  privateInputs?: SandboxPrivateInput[]
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
  /**
   * Which sandbox image to run in. Defaults to 'shell' (the Function base).
   * Trusted Mothership calls pass 'mothership'; workspace callers cannot select it.
   * The Node document engines (pptxgenjs/docx + react-icons/sharp) pass 'doc' so
   * they run in the doc image (mothership-docs).
   */
  sandboxKind?: 'shell' | 'mothership' | 'doc'
  /** Scope for {@link sandboxId}; a sandbox from another workspace is rejected. */
  workspaceId?: string
  /** Workspace sandbox whose dependency set this execution runs against. */
  sandboxId?: string
  /** Cancels the provider sandbox when the caller's execution budget expires. */
  signal?: AbortSignal
}

export interface SandboxExecutionResult {
  result: unknown
  stdout: string
  sandboxId?: string
  error?: string
  exportedFileContent?: string
  exportedFiles?: Record<string, string>
}

/** Result of one command run inside a sandbox. */
export interface SandboxCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  /** The provider stopped the command because its supplied execution budget elapsed. */
  timedOut?: boolean
}

/**
 * Normalized error from a code execution. Both providers report this shape:
 * E2B's `Execution.error` and Daytona's `ExecutionResult.error` agree on
 * `{ name, value, traceback }`, so `formatSandboxError`'s line-offset handling
 * works unchanged across providers.
 */
export interface SandboxCodeError {
  name: string
  value: string
  traceback?: string
}

/** Result of a code (non-shell) execution. */
export interface SandboxCodeResult {
  /** The final-expression value, when the provider surfaces one separately from stdout. */
  text: string
  stdout: string
  stderr: string
  error?: SandboxCodeError
  /** The provider stopped the code runner because its supplied execution budget elapsed. */
  timedOut?: boolean
}

export interface RunCommandOptions {
  envs?: Record<string, string>
  timeoutMs: number
  /** Hard cumulative bound for stdout and stderr retained by the provider adapter. */
  maxOutputBytes?: number
  /** Distinguishes caller cancellation from a provider lifetime timeout. */
  signal?: AbortSignal
  /** Run as root. The shell and Pi paths depend on this; the code path does not. */
  rootUser?: boolean
  /** Never relaunch this command when provider acknowledgement is ambiguous. */
  atMostOnce?: boolean
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

/**
 * A live sandbox. Deliberately the smallest surface that satisfies every caller,
 * so adding a third provider stays cheap.
 */
export interface SandboxHandle {
  readonly sandboxId: string
  /**
   * Runs code in the language fixed at {@link SandboxProvider.create} time.
   * Language is bound at creation rather than per call because Daytona applies it
   * as a sandbox label (`code-toolbox-language`) and silently ignores a per-call
   * override — passing `javascript` to its `codeRun` executes the source through
   * Python instead. We create one sandbox per execution, so binding costs nothing.
   */
  runCode(
    code: string,
    options: {
      timeoutMs: number
      envs?: Record<string, string>
      javascriptPreload?: string
      maxOutputBytes?: number
      signal?: AbortSignal
    }
  ): Promise<SandboxCodeResult>
  runCommand(command: string, options: RunCommandOptions): Promise<SandboxCommandResult>
  /** Reads provider metadata without materializing the file contents. */
  getFileSize(path: string): Promise<number>
  readFile(path: string): Promise<string>
  /**
   * Streams a regular file with a cumulative byte limit applied while reading.
   * Metadata checks are advisory; this method must independently enforce the
   * limit so a file replacement or growth between stat and read stays bounded.
   */
  readFileWithLimit(
    path: string,
    options: {
      maxBytes: number
      encoding: 'utf8' | 'base64'
      signal?: AbortSignal
    }
  ): Promise<{ content: string; byteLength: number }>
  /**
   * Writes a file via the sandbox filesystem API. Bytes never pass through a
   * shell, so untrusted content (an assembled prompt, a commit message) is
   * delivered without any shell parsing.
   */
  writeFile(path: string, content: string | ArrayBuffer): Promise<void>
  kill(): Promise<void>
}

export interface CreateSandboxOptions {
  /** Bound at creation — see {@link SandboxHandle.runCode}. */
  language?: CodeLanguage
  /**
   * Provider image to create from, overriding the env-configured template.
   * Honored for `code` and `shell` only: Mothership, doc, and Pi keep their
   * vetted images unconditionally, so a user's dependency set can never
   * displace those server-owned runtimes.
   */
  imageRef?: string
  /**
   * How long the provider may keep the sandbox alive before reaping it. E2B
   * accepts milliseconds directly; Daytona receives a rounded-up wall-clock TTL
   * and creates the sandbox as ephemeral.
   */
  lifetimeMs?: number
}

/**
 * How a provider materializes a custom dependency set.
 *
 * `prebuilt` bakes it into a reusable image ahead of time (E2B, whose templates
 * have no count limit and layer cheaply). `runtime` installs it inside the
 * sandbox before user code runs (Daytona, whose 30-snapshot organization quota
 * does not scale with tier and so cannot hold per-workspace images).
 */
export type SandboxDependencyStrategy = 'prebuilt' | 'runtime'

export type SandboxImageStatus = 'pending' | 'building' | 'ready' | 'failed'

/** Internal registry marker: the retained image was ready before its base release changed. */
export const SANDBOX_BASE_RELEASE_REFRESH_CODE = 'base_release_refresh'

/** Handle to an in-flight or completed provider build. */
export interface SandboxImageBuild {
  /** The value passed back as {@link CreateSandboxOptions.imageRef}. */
  imageRef: string
  buildId: string
  /** Provider-side image identifier, when it differs from the human-facing ref. */
  providerImageId?: string
}

export interface SandboxImageBuildStatus {
  status: SandboxImageStatus
  error?: SandboxBuildError
  /** Provider log tail, kept for the failure disclosure. */
  logs?: string
}

/** Immutable provider inputs and monotonic identity for one rendered dependency image. */
export interface SandboxImageMaterialization {
  /** Recipe identity used to route and verify the compatible Trigger.dev task. */
  rendererRevision: number
  /** Monotonic target persisted in the registry; newer deployments never rebuild backward. */
  generation: number
  /** Prefix shared by exact provider refs built for this target and semantic spec. */
  imageRefPrefix: string
  /** Immutable provider base used by the worker instead of re-reading mutable process config. */
  baseImageRef: string
}

/**
 * Build side of a `prebuilt` provider. Split from {@link SandboxProvider} so a
 * `runtime` provider simply omits it and the type makes that unambiguous.
 */
export interface SandboxImageBuilder {
  /** Worker recipe identity; a mismatched payload must never claim a registry row. */
  readonly rendererRevision: number
  /**
   * Prefix shared by every exact provider ref materialized from the current
   * immutable base release and this semantic spec hash. A base release change
   * changes the prefix without changing the workspace-owned semantic hash.
   */
  materialization(specHash: string): SandboxImageMaterialization
  /** Parses the active generation encoded in an exact provider image reference. */
  imageRefGeneration(imageRef: string): number | undefined
  startBuild(
    spec: SandboxSpec,
    specHash: string,
    materialization: SandboxImageMaterialization
  ): Promise<SandboxImageBuild>
  /** `spec` is carried through so a failure can be classified against the right registry. */
  getBuildStatus(build: SandboxImageBuild, spec: SandboxSpec): Promise<SandboxImageBuildStatus>
  /** Removes a built image from the provider. Used by the retention sweep. */
  deleteImage(build: SandboxImageBuild): Promise<void>
  /**
   * Whether a failure from {@link SandboxProvider.create} means the image itself
   * is gone, rather than anything else that can go wrong reaching the provider.
   *
   * Only a `prebuilt` provider can answer this, and it is what makes a dead
   * `imageRef` self-correcting: the registry and the provider are two systems with
   * no shared transaction, so instead of trying to keep them in step, the create
   * that observes the truth reports it. Must stay narrow — treating an auth or
   * rate-limit failure as a missing image would rebuild on every outage.
   */
  isMissingImage(error: unknown): Promise<boolean>
}

export interface SandboxProvider {
  readonly id: SandboxProviderId
  readonly dependencyStrategy: SandboxDependencyStrategy
  /** Present exactly when {@link dependencyStrategy} is `prebuilt`. */
  readonly images?: SandboxImageBuilder
  create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle>
}
