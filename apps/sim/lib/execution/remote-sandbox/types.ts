import type { CodeLanguage } from '@/lib/execution/languages'

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
  runCode(code: string, options: { timeoutMs: number }): Promise<SandboxCodeResult>
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
}

export interface SandboxProvider {
  readonly id: SandboxProviderId
  create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle>
}
