/**
 * Types for the sandbox task system.
 *
 * A `SandboxTask` is a recipe that tells the isolated-vm pool how to run a
 * particular kind of user code: which pre-built library bundles to install,
 * which host-side brokers to expose, and how to serialize the final result.
 */

export type SandboxBundleName = 'pptxgenjs' | 'docx' | 'pdf-lib'

export interface SandboxBroker<TArgs = unknown, TResult = unknown> {
  /**
   * Name the isolate-side bootstrap references (e.g. `__brokers.workspaceFile`).
   * Must be a plain JS identifier segment.
   */
  name: string
  /**
   * Host-side handler invoked when the isolate calls the broker.
   * `ctx` carries per-execution metadata (workspaceId, requestId, etc.).
   */
  handle(ctx: SandboxBrokerContext, args: TArgs): Promise<TResult>
}

export interface SandboxBrokerContext {
  workspaceId: string
  requestId: string
}

export interface SandboxTaskInput {
  workspaceId: string
  code: string
}

export interface SandboxTask<TInput extends SandboxTaskInput = SandboxTaskInput> {
  /** Kebab-case stable identifier, used for logging + lookups. */
  id: string
  /** Script execution timeout inside the isolate. */
  timeoutMs: number
  /** Library bundles to load as isolate globals before the bootstrap runs. */
  bundles: ReadonlyArray<SandboxBundleName>
  /** Host-side brokers this task is allowed to call from inside the isolate. */
  brokers: ReadonlyArray<SandboxBroker>
  /**
   * JS code run inside the isolate after bundles are installed and before
   * user code. Should hoist bundle globals to friendly names and install any
   * helper functions users expect (e.g. `getFileBase64`).
   */
  bootstrap: string
  /**
   * JS source that, when evaluated inside an async IIFE after user code, must
   * return a `Uint8Array`. The bytes are transferred out via `ExternalCopy`.
   */
  finalize: string
  /** Host-side transform from raw isolate bytes to the caller's return type. */
  toResult(bytes: Uint8Array, input: TInput): Buffer
}
