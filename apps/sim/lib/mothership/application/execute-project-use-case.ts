import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { projectOperations } from '@/lib/projects/application'
import { PROJECT_DISCOVERY_DELEGATION_TTL_MS } from '@/lib/projects/application/operations'

export const executeCopilotProjectDiscovery = createCopilotApplicationAdapter({
  mode: 'resource',
  domain: 'project discovery',
  operations: { list: projectOperations.list },
  resourceScope: { kind: 'project_discovery' },
  delegation: {
    audience: projectOperations.list.delegationAudience,
    ttlMs: PROJECT_DISCOVERY_DELEGATION_TTL_MS,
    createDelegationId: (context) => context.toolCallId,
  },
})
