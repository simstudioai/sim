import type {
  ResourcePolicyConditionKey,
  ResourcePolicyConditionOperator,
} from '@/lib/resource-policies/conditions'
import type { ResourcePolicyPrincipal } from '@/lib/resource-policies/principals'
import type {
  ResourcePolicyAction,
  ResourcePolicyResourceType,
} from '@/lib/resource-policies/registry'

export {
  RESOURCE_POLICY_ACTIONS,
  RESOURCE_POLICY_RESOURCE_TYPES,
  type ResourcePolicyAction,
  type ResourcePolicyResourceType,
} from '@/lib/resource-policies/registry'

export type ResourcePolicyEffect = 'allow' | 'deny'

export type ResourcePolicyCondition = Partial<
  Record<ResourcePolicyConditionOperator, Partial<Record<ResourcePolicyConditionKey, unknown>>>
>

export interface ResourcePolicyStatement {
  sid: string
  effect: ResourcePolicyEffect
  actions: readonly ResourcePolicyAction[]
  principals: readonly ResourcePolicyPrincipal[]
  condition?: ResourcePolicyCondition
}

export type ResourcePolicyTarget<ResourceType extends ResourcePolicyResourceType> = (
  | { workspaceId: string; organizationId?: never }
  | { organizationId: string; workspaceId?: never }
) & {
  resourceType: ResourceType
  resourceId: string
}

export interface ResourcePolicyDocument<ResourceType extends ResourcePolicyResourceType> {
  version: number
  resource: {
    type: ResourceType
    id: string
  }
  statements: readonly ResourcePolicyStatement[]
}

/** Lets each resource own its strict document format while storage stays resource-agnostic. */
export interface ResourcePolicyCodec<
  ResourceType extends ResourcePolicyResourceType,
  Document extends ResourcePolicyDocument<ResourceType>,
> {
  readonly resourceType: ResourceType
  parse(value: unknown, expected: { type: ResourceType; id: string }): Document
}
