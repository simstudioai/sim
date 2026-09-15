import { posix } from 'node:path'
import type {
  DelegatedPrincipal,
  PersonalApiKeyPrincipal,
  SessionPrincipal,
} from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import type { SessionFileIdentity } from '@/lib/execution/remote-sandbox/session-file-observer'
import { isSessionFileProvenanceClean } from '@/lib/execution/remote-sandbox/session-file-provenance'
import { openSessionFileSnapshot } from '@/lib/execution/remote-sandbox/session-file-snapshot'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { resolveOwnedWorkspaceChatContext } from '@/lib/mothership/chat/application/context'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'

/** Absolute scratch paths are explicit; failed workspace reads never select a workbench. */
export function normalizeScratchPath(path: string) {
  if (!path.startsWith('/') || path.includes('\0'))
    throw new OrchestrationError('validation', 'An absolute sandbox path is required')
  const normalized = posix.normalize(path)
  if (!normalized.startsWith('/tmp/') && !normalized.startsWith('/home/user/')) {
    throw new OrchestrationError(
      'validation',
      'Sandbox reads require a path under /tmp or /home/user'
    )
  }
  return normalized
}

interface ReadSandboxFileInput {
  chatId: string
  workspaceId: string
  path: string
  maxBytes?: number
  signal?: AbortSignal
}

/** Reads a fixed snapshot from the caller's existing private chat machine, never server disk. */
export const readChatSandboxFile = defineAuthorizedWorkspaceUseCase({
  operation: defineWorkspaceOperation({
    id: 'mothership.chats.read_sandbox_file',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session', 'personal_api_key', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  async resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal | PersonalApiKeyPrincipal | DelegatedPrincipal
    input: ReadSandboxFileInput
  }) {
    const context = await resolveOwnedWorkspaceChatContext(principal, input.chatId)
    if (context.workspaceId !== input.workspaceId)
      throw new OrchestrationError('not_found', 'Chat not found')
    return context
  },
  authorizationOptions: {
    delegation: {
      audience: workspaceFileDelegationPolicy.audience,
      isWithinScope: (principal, context) =>
        principal.resourceScope?.chatId === context.chatId &&
        principal.resourceScope?.fileId === undefined,
    },
  },
  async execute({ context, input }) {
    const path = normalizeScratchPath(input.path)
    const maxBytes = input.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_TEXT_EXTRACTION_BYTES) {
      throw new OrchestrationError('validation', 'Invalid sandbox read byte limit')
    }
    input.signal?.throwIfAborted()
    const sessionKey = chatSandboxSessionKey(context.chatId)
    const provenance = createWorkbenchFileProvenance({
      workspaceId: context.workspaceId,
      userId: context.userId,
      sessionKey,
      signal: input.signal,
    })
    let machine: SessionFileIdentity | undefined
    const snapshot = await openSessionFileSnapshot(
      sessionKey,
      path,
      input.signal,
      (identity, stream) => {
        machine = identity
        return provenance.observeUpload(identity, stream)
      },
      { allowedRoots: ['/home/user', '/tmp'], maxBytes }
    )
    try {
      if (snapshot.size > maxBytes)
        throw new OrchestrationError(
          'payload_too_large',
          'Sandbox file exceeds the read byte limit'
        )
      const buffer = await readStreamToBufferWithLimit(await snapshot.stream(), {
        maxBytes,
        label: 'Sandbox file',
      })
      input.signal?.throwIfAborted()
      const receipt = provenance.uploadProvenance()
      const exactEmpty = receipt.status === 'exact' && receipt.entries.length === 0
      if (
        (receipt.status === 'exact' && receipt.entries.length > 0) ||
        (!exactEmpty && (!machine || !(await isSessionFileProvenanceClean(sessionKey, machine))))
      ) {
        throw new OrchestrationError(
          'forbidden',
          'This scratch file has no verified secret-free provenance. Read a verified source or regenerate it in a fresh workbench.'
        )
      }
      input.signal?.throwIfAborted()
      return { buffer, path, name: posix.basename(path) }
    } finally {
      await snapshot.dispose()
    }
  },
})
