import type { CodeLanguage } from '@/lib/execution/languages'
import type { SandboxBuildError } from '@/lib/execution/remote-sandbox/build-errors'
import type { SandboxSpec } from '@/lib/execution/remote-sandbox/sandbox-spec'

/**
 * Which vetted image a sandbox runs in. Every kind fails closed when its
 * template/snapshot id is unset, so LLM-authored code can never land in a
 * provider's unvetted default image.
 */
export type SandboxKind = 'code' | 'shell' | 'doc' | 'pi'

export type SandboxProviderId = 'e2b' | 'daytona'

/**
 * A sandbox input file. `content` entries are written inline; `url` entries are fetched from inside
 * the sandbox (so large mounts never pass their bytes through the web process).
 */
export type SandboxFile =
  | { type?: 'content'; path: string; content: string; encoding?: 'base64' }
  | { type: 'url'; path: string; url: string }

export interface SandboxExecutionRequest {
  code: string
  language: CodeLanguage
  timeoutMs: number
  sandboxFiles?: SandboxFile[]
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
  /**
   * Which sandbox image to run in. Defaults to 'code' (mothership-shell).
   * Document generation passes 'doc' so it runs in the doc image
   * (mothership-docs) that has python-pptx/docx/openpyxl/reportlab installed.
   */
  sandboxKind?: 'code' | 'doc'
  /** Scope for {@link sandboxId}; a sandbox from another workspace is rejected. */
  workspaceId?: string
  /** Workspace sandbox whose dependency set this execution runs against. */
  sandboxId?: string
}

export interface SandboxShellExecutionRequest {
  code: string
  envs: Record<string, string>
  timeoutMs: number
  sandboxFiles?: SandboxFile[]
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
  /**
   * Which sandbox image to run in. Defaults to 'shell' (mothership-shell).
   * The Node document engines (pptxgenjs/docx + react-icons/sharp) pass 'doc' so
   * they run in the doc image (mothership-docs).
   */
  sandboxKind?: 'shell' | 'doc'
  /** Scope for {@link sandboxId}; a sandbox from another workspace is rejected. */
  workspaceId?: string
  /** Workspace sandbox whose dependency set this execution runs against. */
  sandboxId?: string
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
}

export interface RunCommandOptions {
  envs?: Record<string, string>
  timeoutMs: number
  /** Run as root. The shell and Pi paths depend on this; the code path does not. */
  rootUser?: boolean
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
    options: { timeoutMs: number; envs?: Record<string, string> }
  ): Promise<SandboxCodeResult>
  runCommand(command: string, options: RunCommandOptions): Promise<SandboxCommandResult>
  readFile(path: string): Promise<string>
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
   * Honored for `code` and `shell` only: `doc` and `pi` keep their vetted images
   * unconditionally, so a user's dependency set can never displace the document
   * compiler's or the coding agent's.
   */
  imageRef?: string
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

/**
 * Build side of a `prebuilt` provider. Split from {@link SandboxProvider} so a
 * `runtime` provider simply omits it and the type makes that unambiguous.
 */
export interface SandboxImageBuilder {
  startBuild(spec: SandboxSpec, specHash: string): Promise<SandboxImageBuild>
  /** `spec` is carried through so a failure can be classified against the right registry. */
  getBuildStatus(build: SandboxImageBuild, spec: SandboxSpec): Promise<SandboxImageBuildStatus>
  /** Removes a built image from the provider. Used by the retention sweep. */
  deleteImage(build: SandboxImageBuild): Promise<void>
}

export interface SandboxProvider {
  readonly id: SandboxProviderId
  readonly dependencyStrategy: SandboxDependencyStrategy
  /** Present exactly when {@link dependencyStrategy} is `prebuilt`. */
  readonly images?: SandboxImageBuilder
  create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle>
}
