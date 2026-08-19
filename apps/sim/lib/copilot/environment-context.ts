import {
  type EnvironmentResolutionSnapshot,
  getEffectiveEnvironmentSnapshot,
} from '@/lib/environment/utils'
import {
  createResolvedSecretTraceRegistry,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export interface CopilotEnvironmentContext {
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
}

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
    personalOwners: environment.personalOwners,
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
