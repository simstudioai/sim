export const RESOURCE_POLICY_CONDITION_OPERATORS = ['Bool', 'StringEquals'] as const

export type ResourcePolicyConditionOperator = (typeof RESOURCE_POLICY_CONDITION_OPERATORS)[number]

export interface ResourcePolicyConditionEvaluationFacts {
  credentialGroupActorEnrollmentId?: string
  credentialGroupCredentialEnrollmentId?: string
  /** The option the credential being accessed was collected under. */
  credentialGroupOptionId?: string
  currentWorkflow?: {
    workflowId: string
    mode: 'draft' | 'deployment'
  }
}

export interface ResourcePolicyConditionOption {
  value: string | boolean
  label: string
}

export type ResourcePolicyConditionSelector =
  | { type: 'static'; options: readonly ResourcePolicyConditionOption[] }
  | { type: 'internal' }

export type ResourcePolicyConditionValueType = 'boolean' | 'string'

export interface ResourcePolicyConditionDefinition {
  key: ResourcePolicyConditionKey
  label: string
  valueType: ResourcePolicyConditionValueType
  operators: readonly ResourcePolicyConditionOperator[]
  selector: ResourcePolicyConditionSelector
  resolve(facts: ResourcePolicyConditionEvaluationFacts): boolean | string | undefined
}

export type ResourcePolicyConditionKey =
  | 'credential_group:ActorOwnsCredential'
  | 'credential_group:OptionId'
  | 'execution:WorkflowMode'

export function defineResourcePolicyCondition(
  definition: ResourcePolicyConditionDefinition
): ResourcePolicyConditionDefinition {
  if (!definition.label.trim()) {
    throw new Error(`Resource policy condition ${definition.key} requires a label`)
  }
  if (definition.operators.length === 0) {
    throw new Error(`Resource policy condition ${definition.key} requires an operator`)
  }
  if (definition.selector.type === 'static' && definition.selector.options.length === 0) {
    throw new Error(`Resource policy condition ${definition.key} requires selector options`)
  }
  const expectedValueType = definition.valueType === 'boolean' ? 'boolean' : 'string'
  if (
    definition.selector.type === 'static' &&
    definition.selector.options.some((option) => typeof option.value !== expectedValueType)
  ) {
    throw new Error(`Resource policy condition ${definition.key} has invalid selector values`)
  }
  const allowedOperators: readonly ResourcePolicyConditionOperator[] =
    definition.valueType === 'boolean' ? ['Bool'] : ['StringEquals']
  if (definition.operators.some((operator) => !allowedOperators.includes(operator))) {
    throw new Error(`Resource policy condition ${definition.key} has an incompatible operator`)
  }
  return Object.freeze(definition)
}
