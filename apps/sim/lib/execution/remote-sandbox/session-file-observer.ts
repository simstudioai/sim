import type { SandboxProviderId } from '@/lib/execution/remote-sandbox/types'

/** Provider identity comes from the acquired machine, never a caller's path or environment. */
export interface SessionFileIdentity {
  providerId: SandboxProviderId
  sandboxId: string
}

export type SessionFileObserver = (
  source: SessionFileIdentity,
  stream: ReadableStream<Uint8Array>
) => ReadableStream<Uint8Array>
