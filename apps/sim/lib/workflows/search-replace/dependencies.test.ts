/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getWorkflowSearchDependentClears } from '@/lib/workflows/search-replace/dependencies'
import type { SubBlockConfig } from '@/blocks/types'

describe('getWorkflowSearchDependentClears', () => {
  it('returns transitive dependents without cycling', () => {
    const subBlocks: SubBlockConfig[] = [
      { id: 'credential', title: 'Credential', type: 'oauth-input' },
      { id: 'project', title: 'Project', type: 'project-selector', dependsOn: ['credential'] },
      { id: 'issue', title: 'Issue', type: 'file-selector', dependsOn: ['project'] },
      { id: 'assignee', title: 'Assignee', type: 'user-selector', dependsOn: ['issue'] },
      { id: 'unrelated', title: 'Unrelated', type: 'short-input' },
    ]

    expect(getWorkflowSearchDependentClears(subBlocks, 'credential')).toEqual([
      { subBlockId: 'project', reason: 'project depends on credential' },
      { subBlockId: 'issue', reason: 'issue depends on project' },
      { subBlockId: 'assignee', reason: 'assignee depends on issue' },
    ])
  })
})
