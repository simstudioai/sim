import {
  v2ListCredentialMembersContract,
  v2RemoveCredentialMemberContract,
  v2UpsertCredentialMemberContract,
} from '@/lib/api/contracts/v2/credentials'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
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
      summary: 'List credential members',
      description: `List explicit credential grants, including revoked grants, and inherited workspace Admin access. Personal API keys and OAuth access tokens can list grants for OAuth or service-account credentials. Requires workspace read access and the \`integrations.manage\` capability. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Credentials'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of explicit and inherited credential grants.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListCredentialMembersContract.params,
        'ListCredentialMembersParams',
        'List credential members parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2ListCredentialMembersContract.query,
        'ListCredentialMembersQuery',
        'Query parameters',
        'Workspace scope, sorting, and pagination controls.'
      ),
      response: documentedSchema(
        v2ListCredentialMembersContract.response.schema,
        'ListCredentialMembersResponse',
        'List credential members response',
        'A page of explicit and inherited credential grants.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpsertCredentialMemberContract,
    {
      applicationOperation: credentialOperations.upsertMember,
      operationId: 'upsertCredentialMember',
      summary: 'Upsert credential member',
      description: `Grant or change a current workspace member’s credential role. Requires credential Admin access and the \`integrations.manage\` capability. Revoked grants become active again; inherited workspace Admins cannot be demoted. A new grant returns \`201\`; an existing grant returns \`200\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Credentials'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The saved credential role and whether a grant was created.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpsertCredentialMemberContract.params,
        'UpsertCredentialMemberParams',
        'Upsert credential member parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2UpsertCredentialMemberContract.query,
        'UpsertCredentialMemberQuery',
        'Query parameters',
        'Workspace containing the credential.'
      ),
      body: documentedSchema(
        v2UpsertCredentialMemberContract.body,
        'UpsertCredentialMemberBody',
        'Upsert credential member body',
        'The current workspace member and credential role to grant.'
      ),
      response: documentedSchema(
        v2UpsertCredentialMemberContract.response.schema,
        'UpsertCredentialMemberResponse',
        'Upsert credential member response',
        'The saved credential role and whether a grant was created.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RemoveCredentialMemberContract,
    {
      applicationOperation: credentialOperations.removeMember,
      operationId: 'removeCredentialMember',
      summary: 'Remove credential member',
      description: `Revoke an active explicit credential grant. Requires credential Admin access and the \`integrations.manage\` capability. Inherited workspace Admins cannot be removed; an absent or already-revoked grant returns \`404\`. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Credentials'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Acknowledgement that the explicit credential grant was revoked.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RemoveCredentialMemberContract.params,
        'RemoveCredentialMemberParams',
        'Remove credential member parameters',
        'Resource identifiers.'
      ),
      query: documentedSchema(
        v2RemoveCredentialMemberContract.query,
        'RemoveCredentialMemberQuery',
        'Query parameters',
        'Workspace containing the credential.'
      ),
      response: documentedSchema(
        v2RemoveCredentialMemberContract.response.schema,
        'RemoveCredentialMemberResponse',
        'Remove credential member response',
        'Acknowledgement that the explicit credential grant was revoked.'
      ),
    }
  ),
] as const
