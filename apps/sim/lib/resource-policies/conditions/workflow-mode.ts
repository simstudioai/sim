import { defineResourcePolicyCondition } from '@/lib/resource-policies/conditions/types'

export const WORKFLOW_MODE_RESOURCE_POLICY_CONDITION_KEY = 'execution:WorkflowMode' as const

export const workflowModeResourcePolicyConditionDefinition = defineResourcePolicyCondition({
  key: WORKFLOW_MODE_RESOURCE_POLICY_CONDITION_KEY,
  label: 'Workflow mode',
  valueType: 'string',
  operators: ['StringEquals'],
  selector: {
    type: 'static',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'deployment', label: 'Deployed' },
    ],
  },
  resolve: (facts) => facts.currentWorkflow?.mode,
})
