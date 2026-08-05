import type { ExecutionContext } from '@/lib/copilot/request/types'
import {
  type EnvironmentResolutionSnapshot,
  getEffectiveEnvironmentSnapshot,
} from '@/lib/environment/utils'
import { createResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export type CopilotEnvironmentContext = Pick<ExecutionContext, 'resolvedSecretTraceRegistry'>

export async function createCopilotEnvironmentContext(
  userId: string,
  workspaceId: string | undefined,
  environment: EnvironmentResolutionSnapshot
): Promise<CopilotEnvironmentContext> {
  const resolvedSecretTraceRegistry = await createResolvedSecretTraceRegistry({
    personalEncrypted: environment.personalEncrypted,
    workspaceEncrypted: environment.workspaceEncrypted,
    personalDecrypted: environment.personalDecrypted,
    workspaceDecrypted: environment.workspaceDecrypted,
    decryptionFailures: environment.decryptionFailures,
    scope: { userId, workspaceId },
  })

  return {
    resolvedSecretTraceRegistry,
  }
}

export async function prepareCopilotEnvironmentContext(
  userId: string,
  workspaceId?: string
): Promise<CopilotEnvironmentContext> {
  const environment = await getEffectiveEnvironmentSnapshot(userId, workspaceId)
  return createCopilotEnvironmentContext(userId, workspaceId, environment)
}
