import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  jsmApprovalsBodySchema,
  jsmCommentsBodySchema,
  jsmCustomersBodySchema,
  jsmIssuePaginationBodySchema,
  jsmParticipantsBodySchema,
  jsmQueuesBodySchema,
  jsmRequestsBodySchema,
  jsmRequestTypesToolBodySchema,
  jsmServiceDeskScopedBodySchema,
  jsmServiceDesksBodySchema,
} from '@/lib/api/contracts/tools/jsm'
import { JiraServiceManagementBlock } from '@/blocks/blocks/jira_service_management'
import {
  jsmGetApprovalsTool,
  jsmGetCommentsTool,
  jsmGetCustomersTool,
  jsmGetOrganizationsTool,
  jsmGetParticipantsTool,
  jsmGetQueuesTool,
  jsmGetRequestsTool,
  jsmGetRequestTypesTool,
  jsmGetServiceDesksTool,
  jsmGetSlaTool,
  jsmGetTransitionsTool,
} from '@/tools/jsm'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const DOMAIN = 'example.atlassian.net'
/** Injected by the executor from the OAuth credential before the tool's operation input runs. */
const ACCESS_TOKEN = 'token-123'

interface PaginatedCase {
  operation: string
  toolId: string
  /** The tool's operation input, captured at its concrete param type by `paginatedCase`. */
  buildInput: (params: Record<string, unknown>) => Record<string, unknown>
  schema: z.ZodType
  extraInputs: Record<string, string>
}

/**
 * Captures each tool at its own generic so an incompatible tool/contract pairing is still a type
 * error at the call site, rather than being erased by a widened `ToolConfig` in the table type.
 */
function paginatedCase<P, R extends ToolResponse>(
  operation: string,
  tool: InternalToolConfig<P, R>,
  schema: z.ZodType,
  extraInputs: Record<string, string> = {}
): PaginatedCase {
  return {
    operation,
    toolId: tool.id,
    buildInput: (params) => tool.operation.input(params as P) as Record<string, unknown>,
    schema,
    extraInputs,
  }
}

/**
 * Every paginated JSM operation, wired to the tool it resolves to and the schema its direct
 * handler parses the operation input with. This walks the real chain — block
 * `tools.config.params` → the tool's `operation.input` → direct-handler validation — where the
 * tools declare `start`/`limit` as numbers and the provider operation normalizes them to strings.
 */
const PAGINATED_CASES: PaginatedCase[] = [
  paginatedCase('get_service_desks', jsmGetServiceDesksTool, jsmServiceDesksBodySchema),
  paginatedCase('get_request_types', jsmGetRequestTypesTool, jsmRequestTypesToolBodySchema, {
    serviceDeskId: '1',
  }),
  paginatedCase('get_requests', jsmGetRequestsTool, jsmRequestsBodySchema),
  paginatedCase('get_comments', jsmGetCommentsTool, jsmCommentsBodySchema, {
    issueIdOrKey: 'SD-123',
  }),
  paginatedCase('get_customers', jsmGetCustomersTool, jsmCustomersBodySchema, {
    serviceDeskId: '1',
  }),
  paginatedCase('get_organizations', jsmGetOrganizationsTool, jsmServiceDeskScopedBodySchema, {
    serviceDeskId: '1',
  }),
  paginatedCase('get_queues', jsmGetQueuesTool, jsmQueuesBodySchema, { serviceDeskId: '1' }),
  paginatedCase('get_sla', jsmGetSlaTool, jsmIssuePaginationBodySchema, { issueIdOrKey: 'SD-123' }),
  paginatedCase('get_transitions', jsmGetTransitionsTool, jsmIssuePaginationBodySchema, {
    issueIdOrKey: 'SD-123',
  }),
  paginatedCase('get_participants', jsmGetParticipantsTool, jsmParticipantsBodySchema, {
    issueIdOrKey: 'SD-123',
  }),
  paginatedCase('get_approvals', jsmGetApprovalsTool, jsmApprovalsBodySchema, {
    issueIdOrKey: 'SD-123',
  }),
]

/** Run block inputs through `tools.config.params`, then through the tool's operation input. */
function buildOperationInput(
  { operation, buildInput, extraInputs }: PaginatedCase,
  pagination: Record<string, string>
) {
  const paramsFn = JiraServiceManagementBlock.tools.config?.params
  if (!paramsFn) throw new Error('Block is missing tools.config.params')

  const toolParams = paramsFn({
    oauthCredential: 'cred-1',
    domain: DOMAIN,
    operation,
    ...extraInputs,
    ...pagination,
  })

  return buildInput({ ...toolParams, accessToken: ACCESS_TOKEN, domain: DOMAIN })
}

describe.each(PAGINATED_CASES.map((testCase) => [testCase.operation, testCase] as const))(
  'JiraServiceManagementBlock %s',
  (_operation, testCase) => {
    it('builds direct operation input accepted by the handler when pagination is blank', () => {
      const input = buildOperationInput(testCase, {})

      expect(input.start).toBeUndefined()
      expect(input.limit).toBeUndefined()
      expect(() => testCase.schema.parse(input)).not.toThrow()
    })

    it('drops non-numeric pagination input instead of sending NaN', () => {
      const input = buildOperationInput(testCase, {
        startIndex: 'not-a-number',
        maxResults: '',
      })

      expect(input.start).toBeUndefined()
      expect(input.limit).toBeUndefined()
      expect(() => testCase.schema.parse(input)).not.toThrow()
    })
  }
)

/**
 * What a tool call (agent, Pi, Human v2) hands the tool: the merged stored-row and model args,
 * overlaid with the block mapper's output. The operation arrives only in `context`.
 */
function toolCallParams(operation: string, args: Record<string, unknown>) {
  const mapper = JiraServiceManagementBlock.tools.config?.params
  if (!mapper) throw new Error('Block is missing tools.config.params')
  return { ...args, ...mapper({ domain: DOMAIN, ...args }, { operation }) }
}

describe('JiraServiceManagementBlock tool calls', () => {
  it('maps fields set on the agent tool row to the tool param names', () => {
    expect(
      toolCallParams('add_comment', { issueIdOrKey: 'SD-1', commentBody: 'From the row' }).body
    ).toBe('From the row')
    expect(toolCallParams('get_queues', { serviceDeskId: '1', startIndex: '5' }).start).toBe(5)
  })

  it.each([
    ['add_comment', { issueIdOrKey: 'SD-1', body: 'Model comment', isPublic: true }],
    ['get_comments', { issueIdOrKey: 'SD-1', isPublic: false, start: 10, limit: 5 }],
    ['create_organization', { name: 'Acme' }],
    ['add_participants', { issueIdOrKey: 'SD-1', accountIds: 'a,b' }],
    ['answer_approval', { issueIdOrKey: 'SD-1', approvalId: '2', decision: 'approve' }],
    ['save_form_answers', { issueIdOrKey: 'SD-1', formId: 'f', answers: { '1': { text: 'x' } } }],
    ['copy_forms', { sourceIssueIdOrKey: 'SD-1', targetIssueIdOrKey: 'SD-2', formIds: ['u1'] }],
    [
      'create_request',
      { serviceDeskId: '1', requestTypeId: '2', summary: 's', requestFieldValues: { a: 1 } },
    ],
    ['search_objects_aql', { qlQuery: 'Name = x', page: 2, objectTypeId: '7', workspaceId: 'w' }],
    ['create_object', { objectTypeId: '7', attributes: [{ objectTypeAttributeId: '1' }] }],
  ])('keeps model args for %s without throwing', (operation, args) => {
    expect(toolCallParams(operation, args)).toMatchObject(args)
  })
})
