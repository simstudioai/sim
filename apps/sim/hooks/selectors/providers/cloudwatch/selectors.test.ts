/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { cloudwatchSelectors } from '@/hooks/selectors/providers/cloudwatch/selectors'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const AWS_CONTEXT: SelectorQueryArgs['context'] = {
  awsAccessKeyId: 'AKIA',
  awsSecretAccessKey: 'secret',
  awsRegion: 'us-east-1',
  logGroupName: '/aws/lambda/fn',
}

describe('cloudwatch selector query keys', () => {
  it.each([['cloudwatch.logGroups' as const], ['cloudwatch.logStreams' as const]])(
    '%s scopes its key by search, which fetchList forwards as `prefix`',
    (key) => {
      const definition = cloudwatchSelectors[key]
      const base: SelectorQueryArgs = { key, context: AWS_CONTEXT }

      const noSearch = definition.getQueryKey(base)
      const withSearch = definition.getQueryKey({ ...base, search: 'api' })
      const otherSearch = definition.getQueryKey({ ...base, search: 'worker' })

      expect(withSearch).not.toEqual(noSearch)
      expect(withSearch).not.toEqual(otherSearch)
    }
  )
})
