import {
  v2ListCredentialMembersContract,
  v2RemoveCredentialMemberContract,
  v2UpsertCredentialMemberContract,
} from '@/lib/api/contracts/v2/credentials'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { credentialOperations } from '@/lib/credentials/application/operations'
export const credentialMemberOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListCredentialMembersContract,
    {
      applicationOperation: credentialOperations.listMembers,
      operationId: 'listCredentialMembers',
      summary: 'List Credential Members',
      description: `List explicit credential grants, including revoked grants, and inherited workspace administrator access. Requires workspace read access. Credentials must be OAuth or service-account connections. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Credentials'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'List Credential Members result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListCredentialMembersContract.params,
        'ListCredentialMembersParams',
        'List Credential Members parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2ListCredentialMembersContract.query,
        'ListCredentialMembersQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2ListCredentialMembersContract.response.schema,
        'ListCredentialMembersResponse',
        'List Credential Members response',
        'List Credential Members result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpsertCredentialMemberContract,
    {
      applicationOperation: credentialOperations.upsertMember,
      operationId: 'upsertCredentialMember',
      summary: 'Upsert Credential Member',
      description: `Grant or change an existing workspace member’s credential role. Requires credential administrator access. Revoked grants become active again; inherited administrators cannot be demoted. A new grant returns 201; an existing grant returns 200. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Credentials'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Upsert Credential Member result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2UpsertCredentialMemberContract.params,
        'UpsertCredentialMemberParams',
        'Upsert Credential Member parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2UpsertCredentialMemberContract.query,
        'UpsertCredentialMemberQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      body: documentedSchema(
        v2UpsertCredentialMemberContract.body,
        'UpsertCredentialMemberBody',
        'Upsert Credential Member body',
        'Configuration accepted by Upsert Credential Member.'
      ),
      response: documentedSchema(
        v2UpsertCredentialMemberContract.response.schema,
        'UpsertCredentialMemberResponse',
        'Upsert Credential Member response',
        'Upsert Credential Member result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RemoveCredentialMemberContract,
    {
      applicationOperation: credentialOperations.removeMember,
      operationId: 'removeCredentialMember',
      summary: 'Remove Credential Member',
      description: `Revoke an active explicit credential grant. Requires credential administrator access. Inherited workspace administrators cannot be removed; an absent or already-revoked grant returns 404. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Credentials'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Remove Credential Member result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2RemoveCredentialMemberContract.params,
        'RemoveCredentialMemberParams',
        'Remove Credential Member parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2RemoveCredentialMemberContract.query,
        'RemoveCredentialMemberQuery',
        'Query parameters',
        'Filters and pagination controls.'
      ),
      response: documentedSchema(
        v2RemoveCredentialMemberContract.response.schema,
        'RemoveCredentialMemberResponse',
        'Remove Credential Member response',
        'Remove Credential Member result.'
      ),
    }
  ),
] as const
