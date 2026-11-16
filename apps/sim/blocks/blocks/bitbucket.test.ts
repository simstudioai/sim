import { describe, expect, it } from 'vitest'
import { BitbucketBlock } from '@/blocks/blocks/bitbucket'

/**
 * On a tool call the model supplies args under the tool's param names (`refName`, `reviewerUuids`,
 * …) and the operation arrives only in `context`; the handler forwards `{ ...args, ...mapped }`.
 */
const toolCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => {
  const inputs = { workspaceSlug: 'ws', repoSlug: 'repo', ...args }
  return { ...inputs, ...BitbucketBlock.tools.config?.params?.(inputs, { operation }) }
}

describe('BitbucketBlock tool calls', () => {
  it('defaults the ref type and keeps the model ref name on bitbucket_trigger_pipeline', () => {
    const mapped = toolCall('bitbucket_trigger_pipeline', { refName: 'main' })
    expect(mapped).toMatchObject({ refType: 'branch', refName: 'main' })
  })

  it('splits model reviewers and keeps closeSourceBranch on bitbucket_create_pull_request', () => {
    const mapped = toolCall('bitbucket_create_pull_request', {
      title: 'PR',
      sourceBranch: 'feature',
      reviewerUuids: '{a}, {b}',
      closeSourceBranch: true,
    })
    expect(mapped).toMatchObject({ reviewerUuids: ['{a}', '{b}'], closeSourceBranch: true })
  })

  it('keeps the model commit, path and filter on bitbucket_list_directory', () => {
    const mapped = toolCall('bitbucket_list_directory', { commit: 'abc', path: 'src', q: 'x' })
    expect(mapped).toMatchObject({ commit: 'abc', path: 'src', q: 'x' })
  })
})
