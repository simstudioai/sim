import {
  configureSlackSearchContract,
  listSlackSearchContract,
} from '@/lib/api/contracts/knowledge/slack'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  configureSlackSearchInstallation,
  listSlackSearchInstallations,
} from '@/lib/knowledge/application/slack-search/installations'

export const GET = defineInternalJsonRoute({
  contract: listSlackSearchContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.listSlackInstallations,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-settings' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listSlackSearchInstallations,
  present: ({ installations, bots }) => ({
    bots,
    installations: installations.map((row) => ({
      ...row,
      lastEventAt: row.lastEventAt?.toISOString() ?? null,
    })),
  }),
})

export const POST = defineInternalJsonRoute({
  contract: configureSlackSearchContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.configureSlackInstallation,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-settings' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: configureSlackSearchInstallation,
  present: (result) => result,
})
