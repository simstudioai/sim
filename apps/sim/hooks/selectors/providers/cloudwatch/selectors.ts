import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

function ensureAwsSelectorCredentials(context: SelectorQueryArgs['context'], key: SelectorKey) {
  if (!context.awsAccessKeyId || !context.awsSecretAccessKey || !context.awsRegion) {
    throw new Error(`Missing AWS credentials for selector ${key}`)
  }

  return {
    accessKeyId: context.awsAccessKeyId,
    secretAccessKey: context.awsSecretAccessKey,
    region: context.awsRegion,
  }
}

export const cloudwatchSelectors = {
  'cloudwatch.logGroups': {
    key: 'cloudwatch.logGroups',
    contracts: [selectorContracts.cloudwatchSelectorLogGroupsContract],
    serverResolvedContextFields: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'cloudwatch.logGroups',
      search ?? '',
    ],
    enabled: ({ context }) =>
      Boolean(
        context.awsAccessKeyId &&
          context.awsSecretAccessKey &&
          context.awsRegion &&
          context.workflowId
      ),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const awsCredentials = ensureAwsSelectorCredentials(context, 'cloudwatch.logGroups')
      const data = await requestJson(selectorContracts.cloudwatchSelectorLogGroupsContract, {
        body: {
          workflowId: context.workflowId!,
          ...awsCredentials,
          prefix: search,
        },
        signal,
      })
      return data.logGroups.map((lg) => ({
        id: lg.logGroupName,
        label: lg.logGroupName,
      }))
    },
    fetchById: async ({ detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      return { id: detailId, label: detailId }
    },
  },
  'cloudwatch.logStreams': {
    key: 'cloudwatch.logStreams',
    contracts: [selectorContracts.cloudwatchSelectorLogStreamsContract],
    serverResolvedContextFields: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'cloudwatch.logStreams',
      context.logGroupName ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) =>
      Boolean(
        context.awsAccessKeyId &&
          context.awsSecretAccessKey &&
          context.awsRegion &&
          context.logGroupName &&
          context.workflowId
      ),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const awsCredentials = ensureAwsSelectorCredentials(context, 'cloudwatch.logStreams')
      if (!context.logGroupName) {
        throw new Error('Missing log group name for cloudwatch.logStreams selector')
      }
      const data = await requestJson(selectorContracts.cloudwatchSelectorLogStreamsContract, {
        body: {
          workflowId: context.workflowId!,
          ...awsCredentials,
          logGroupName: context.logGroupName,
          prefix: search,
        },
        signal,
      })
      return data.logStreams.map((ls) => ({
        id: ls.logStreamName,
        label: ls.logStreamName,
      }))
    },
    fetchById: async ({ detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      return { id: detailId, label: detailId }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'cloudwatch.logGroups' | 'cloudwatch.logStreams'>,
  SelectorDefinition
>
