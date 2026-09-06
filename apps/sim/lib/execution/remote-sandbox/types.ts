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
  | {
      type: 'url'
      path: string
      url: string
      /**
       * Ceiling enforced on the bytes actually transferred, rather than on a size
       * the caller reported. A caller's pre-read check is a fast, well-worded
       * failure; this is what makes it true when the recorded size understates
       * the stored object. Optional only because it crosses the wire; a mount
       * that omits it still gets `MAX_SANDBOX_URL_MOUNT_BYTES`, so the cap
       * cannot be skipped by omission.
       */
      maxBytes?: number
    }

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
  /**
   * Harvest every regular file under this directory after the code succeeds.
   * Unlike {@link outputSandboxPaths}, the paths are discovered rather than
   * declared, so a model that only authors `code` can still return files.
   */
  outputSandboxDir?: string
  /** Scope for {@link sandboxId}; a sandbox from another workspace is rejected. */
  workspaceId?: string
  /** Workspace sandbox whose dependency set this execution runs against. */
  sandboxId?: string
  /** Cancels the provider sandbox when the caller's execution budget expires. */
  signal?: AbortSignal
  /** Adds the remote provider cost to a completed, billable Function outcome. */
  meterUsage?: boolean
  /** See {@link SandboxSessionRequest} — reuses one sandbox across executions. */
  session?: SandboxSessionRequest
}

/**
 * Opts an execution into a reusable session sandbox: the first execution
 * creates and tags the sandbox, later ones reconnect to it, and each one
 * refreshes its idle deadline instead of killing it. Mothership owns the session;
 * metered calls still report execution cost to its normal usage settlement.
 */
export interface SandboxSessionRequest {
  /** Stable identity of the session (e.g. one per Mothership chat). */
  key: string
  /** Deployment-owned CLI artifact. Its versioned directory is prepended to this execution's PATH. */
  cli?: { path: string; content: string }
  /** Extra environment variables present on every execution in the session. */
  envs?: Record<string, string>
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
  /** See {@link SandboxExecutionRequest.outputSandboxDir}. */
  outputSandboxDir?: string
  /** Scope for {@link sandboxId}; a sandbox from another workspace is rejected. */
  workspaceId?: string
  /** Workspace sandbox whose dependency set this execution runs against. */
  sandboxId?: string
  /** Cancels the provider sandbox when the caller's execution budget expires. */
  signal?: AbortSignal
  /** Adds the remote provider cost to a completed, billable Function outcome. */
  meterUsage?: boolean
  /** See {@link SandboxSessionRequest} — reuses one sandbox across executions. */
  session?: SandboxSessionRequest
}

export interface SandboxExecutionCost {
  input: number
  output: number
  /** What the platform bills: the provider cost with the cost multiplier applied. */
  total: number
  /**
   * The provider cost before the multiplier. The copilot settles through the worker,
   * which applies its own platform multiplier to every raw charge (model tokens, web
   * research, and now sandbox time), so it must receive the unmarked amount.
   */
  raw?: number
}

/**
 * Running total a caller accumulates sandbox charges into.
 *
 * A long-lived sandbox reports its cost when it is torn down, which is after the
 * value its caller cares about has already been returned. Handing the layer a
 * sink lets the charge land without reshaping every return type between here and
 * the block that owns the bill.
 */
export interface SandboxCostSink {
  total: number
}

export interface SandboxExecutionResult {
  result: unknown
  stdout: string
  sandboxId?: string
  error?: string
  exportedFileContent?: string
  exportedFiles?: Record<string, string>
  /**
   * Files discovered under {@link SandboxExecutionRequest.outputSandboxDir}.
   *
   * Always base64, never utf8: the extension allowlist that decides encoding for
   * a declared path cannot classify an arbitrary harvested filename, and
   * decoding real binary as utf8 substitutes U+FFFD silently — corruption that
   * arrives looking like a valid file. Base64 is lossless for any byte
   * sequence, and the byte budget is enforced on the decoded length.
   */
  collectedFiles?: SandboxCollectedFile[]
  cost?: SandboxExecutionCost
  /**
   * Present when the execution ran in a session sandbox: `reused` means prior
   * session state (files, installed packages) was still there; `created` means
   * this execution started a fresh sandbox — anything earlier executions wrote
   * is gone.
   */
  sandboxSession?: 'created' | 'reused'
}

/** One harvested output file, carried as base64 with its decoded length. */
export interface SandboxCollectedFile {
  path: string
  relativePath: string
  contentBase64: string
  byteLength: number
}

/** Result of one command run inside a sandbox. */
export interface SandboxCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  /** The provider stopped the command because its supplied execution budget elapsed. */
  timedOut?: boolean
  /** The provider ended execution for an infrastructure reason, not a user-process outcome. */
  providerFailure?: 'provider_limit'
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
  /** The provider ended execution for an infrastructure reason, not a user-program outcome. */
  providerFailure?: 'provider_limit'
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
   * Python instead. Reconnecting a session returns a handle bound to the requested
   * language; the underlying filesystem remains shared.
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
  /**
   * Pushes the provider's reaping deadline out for a session sandbox that just
   * served an execution. Absent on providers without session support.
   */
  extendLifetime?(lifetimeMs: number): Promise<void>
  /** Reads provider metadata without materializing the file contents. */
  getFileSize(path: string): Promise<number>
  readFile(path: string): Promise<string>
  /** Session snapshots are consumed incrementally; the caller owns limits and stream cancellation. */
  readFileStream?(
    path: string,
    options: { signal: AbortSignal }
  ): Promise<ReadableStream<Uint8Array>>
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
  /** Session file transfers stream with backpressure and cancellation, without a buffered fallback. */
  writeFileStream?(
    path: string,
    content: ReadableStream<Uint8Array>,
    options: { signal: AbortSignal }
  ): Promise<void>
  /** Removes a caller-owned temporary file through the provider filesystem API. */
  removeFile(path: string): Promise<void>
  /**
   * Lists regular files under a directory, recursively to `depth`.
   *
   * Uses each provider's filesystem API rather than shelling out to `find`.
   * A shell listing would cost a session per call on Daytona (its
   * `runCommand` creates one, writes an env file, executes, then deletes it),
   * depend on GNU coreutils that a future base image need not carry, and be
   * corrupted by a filename containing a newline — which user code controls.
   *
   * Symlinks are followed, not excluded. Daytona's listing resolves them and
   * reports no field distinguishing one from a regular file, so excluding them
   * is only possible on E2B — and doing it there alone would be a cross-provider
   * divergence that reads as a security property while providing none. It
   * provides none because the harvest is not a privilege boundary: it runs as
   * the same identity as the code, which can already read any file the sandbox
   * can and copy the bytes into the output directory itself.
   *
   * Directories are returned alongside files rather than filtered out, because
   * a directory sitting at the traversal limit is the only evidence that the
   * listing was cut short — see the truncation check in the harvest.
   *
   * Errors propagate rather than degrading to an empty list. The output
   * directory is created before user code runs, so a listing failure is a real
   * fault, and reporting it as "produced nothing" would turn a transient
   * provider error into silent loss of the caller's files.
   */
  listFiles(path: string, options?: { depth?: number }): Promise<SandboxDirectoryEntry[]>
  kill(): Promise<void>
}

/** One entry discovered by {@link SandboxHandle.listFiles}. */
export interface SandboxDirectoryEntry {
  /** Absolute path inside the sandbox. */
  path: string
  /** Path relative to the listed directory, retaining any subdirectories. */
  relativePath: string
  kind: 'file' | 'directory'
  /**
   * Provider-reported size. Advisory only — the read re-enforces its own limit,
   * since the file can change between listing and read.
   */
  size: number
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
  /**
   * Tags the sandbox as a reusable session sandbox so a later execution can
   * find and reconnect to it via {@link SandboxProvider.findSessionSandbox}.
   */
  sessionKey?: string
  /** Reports the instant immediately before the provider SDK create request is dispatched. */
  onProviderRequestStarted?: (startedAtMs: number) => void
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
  /** Resolves the provider's rounded lifetime for both creation and metering. */
  resolveLifetimeMs(lifetimeMs: number): number
  create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle>
  /**
   * Reconnects to a live sandbox previously created with
   * {@link CreateSandboxOptions.sessionKey}, or resolves null when none is
   * available. Lookup failures must throw rather than masquerade as absence.
   * Providers without session support omit this method; callers then
   * run every execution in a fresh sandbox.
   */
  findSessionSandbox?(
    key: string,
    options: { language?: CodeLanguage }
  ): Promise<SandboxHandle | null>
}
