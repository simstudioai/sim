import {
  type ResourcePolicyConditionEvaluationFacts,
  type ResourcePolicyConditionOperator,
  requireResourcePolicyConditionDefinition,
} from '@/lib/resource-policies/conditions'
import {
  matchResourcePolicyPrincipal,
  type ResourcePolicyPrincipalEvaluationFacts,
} from '@/lib/resource-policies/principals'
import { getResourcePolicyDefinition } from '@/lib/resource-policies/registry'
import type {
  ResourcePolicyAction,
  ResourcePolicyDocument,
  ResourcePolicyResourceType,
  ResourcePolicyStatement,
} from '@/lib/resource-policies/types'

export type ResourcePolicyDecision =
  | { decision: 'allow'; statementSid: string }
  | { decision: 'deny'; statementSid: string }
  | { decision: 'implicit_deny' }

export interface ResourcePolicyEvaluationFacts
  extends ResourcePolicyPrincipalEvaluationFacts,
    ResourcePolicyConditionEvaluationFacts {}

interface EvaluateResourcePolicyInput<ResourceType extends ResourcePolicyResourceType> {
  document: ResourcePolicyDocument<ResourceType>
  action: ResourcePolicyAction
  facts: ResourcePolicyEvaluationFacts
}

function conditionMatches(
  statement: ResourcePolicyStatement,
  definition: ReturnType<typeof getResourcePolicyDefinition>,
  facts: ResourcePolicyConditionEvaluationFacts
): boolean {
  if (!statement.condition) return true
  const operators = Object.entries(statement.condition)
  if (operators.length === 0) throw new Error('Resource policy condition must not be empty')

  for (const [operator, entries] of operators) {
    if (!entries || Object.keys(entries).length === 0) {
      throw new Error(`Resource policy condition operator ${operator} must not be empty`)
    }
    for (const [key, expected] of Object.entries(entries)) {
      const condition = requireResourcePolicyConditionDefinition(key)
      if (!definition.conditionKeys.includes(condition.key)) {
        throw new Error(`Condition key ${key} does not apply to this resource`)
      }
      if (!condition.operators.includes(operator as ResourcePolicyConditionOperator)) {
        throw new Error(`Condition operator ${operator} does not apply to ${key}`)
      }
      const expectedType = condition.valueType === 'boolean' ? 'boolean' : 'string'
      if (typeof expected !== expectedType) {
        throw new Error(`Condition ${key} requires a ${expectedType} value`)
      }
      if (condition.resolve(facts) !== expected) return false
    }
  }
  return true
}

function statementMatches<ResourceType extends ResourcePolicyResourceType>(
  statement: ResourcePolicyStatement,
  input: EvaluateResourcePolicyInput<ResourceType>
): boolean {
  const definition = getResourcePolicyDefinition(input.document.resource.type)
  for (const action of statement.actions) {
    if (!definition.actions.includes(action)) {
      throw new Error(`Action ${action} does not apply to ${input.document.resource.type}`)
    }
  }
  if (!statement.actions.includes(input.action)) return false
  if (statement.principals.length === 0) {
    throw new Error(`Resource policy statement ${statement.sid} must contain a principal`)
  }
  const principalMatches = statement.principals.some((principal) => {
    if (!definition.principalTypes.includes(principal.type)) {
      throw new Error(`Principal ${principal.type} does not apply to this resource`)
    }
    return matchResourcePolicyPrincipal(principal, input.facts)
  })
  return principalMatches && conditionMatches(statement, definition, input.facts)
}

export function evaluateResourcePolicy<ResourceType extends ResourcePolicyResourceType>(
  input: EvaluateResourcePolicyInput<ResourceType>
): ResourcePolicyDecision {
  const definition = getResourcePolicyDefinition(input.document.resource.type)
  if (!definition.actions.includes(input.action)) {
    throw new Error(`Action ${input.action} does not apply to ${input.document.resource.type}`)
  }
  for (const statement of input.document.statements) {
    if (statement.effect !== 'allow' && statement.effect !== 'deny') {
      throw new Error(`Resource policy statement ${statement.sid} has an invalid effect`)
    }
  }

  for (const statement of input.document.statements) {
    if (statement.effect === 'deny' && statementMatches(statement, input)) {
      return { decision: 'deny', statementSid: statement.sid }
    }
  }
  for (const statement of input.document.statements) {
    if (statement.effect === 'allow' && statementMatches(statement, input)) {
      return { decision: 'allow', statementSid: statement.sid }
    }
  }
  return { decision: 'implicit_deny' }
}
