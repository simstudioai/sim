/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useVariablesStore } from '@/stores/variables/store'
import { applyWorkflowVariablesToStore } from '@/stores/workflow-diff/utils'

describe('applyWorkflowVariablesToStore', () => {
  beforeEach(() => {
    useVariablesStore.setState({
      variables: {},
      isLoading: false,
      error: null,
      isEditing: null,
    })
  })

  it('hydrates variables for the target workflow and preserves other workflows', () => {
    useVariablesStore.setState({
      variables: {
        old: {
          id: 'old',
          workflowId: 'workflow-a',
          name: 'oldValue',
          type: 'plain',
          value: 'stale',
        },
        other: {
          id: 'other',
          workflowId: 'workflow-b',
          name: 'otherValue',
          type: 'plain',
          value: 'kept',
        },
      },
    })

    applyWorkflowVariablesToStore('workflow-a', {
      next: {
        id: 'next',
        name: 'nextValue',
        type: 'number',
        value: 42,
      },
    })

    expect(useVariablesStore.getState().variables).toEqual({
      other: {
        id: 'other',
        workflowId: 'workflow-b',
        name: 'otherValue',
        type: 'plain',
        value: 'kept',
      },
      next: {
        id: 'next',
        workflowId: 'workflow-a',
        name: 'nextValue',
        type: 'number',
        value: 42,
      },
    })
  })

  it('preserves null variable values from persisted workflow state', () => {
    applyWorkflowVariablesToStore('workflow-a', {
      next: {
        id: 'next',
        name: 'nullableValue',
        type: 'object',
        value: null,
      },
    })

    expect(useVariablesStore.getState().variables.next.value).toBeNull()
  })
})
