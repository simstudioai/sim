/**
 * @vitest-environment node
 */
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
} from '@/lib/api/contracts/selectors/jsm'
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
import type { ToolConfig, ToolResponse } from '@/tools/types'

const DOMAIN = 'example.atlassian.net'
/** Injected by the executor from the OAuth credential before the tool's `body` runs. */
const ACCESS_TOKEN = 'token-123'

interface PaginatedCase {
  operation: string
  toolId: string
  /** The tool's own `request.body`, captured at its concrete param type by `paginatedCase`. */
  buildBody: (params: Record<string, unknown>) => Record<string, unknown>
  schema: z.ZodType
  extraInputs: Record<string, string>
}

/**
 * Captures each tool at its own generic so an incompatible tool/contract pairing is still a type
 * error at the call site, rather than being erased by a widened `ToolConfig` in the table type.
 */
function paginatedCase<P, R extends ToolResponse>(
  operation: string,
  tool: ToolConfig<P, R>,
  schema: z.ZodType,
  extraInputs: Record<string, string> = {}
): PaginatedCase {
  return {
    operation,
    toolId: tool.id,
    buildBody: (params) => {
      const bodyFn = tool.request.body
      if (!bodyFn) throw new Error(`${tool.id} is missing request.body`)
      return bodyFn(params as P) as Record<string, unknown>
    },
    schema,
    extraInputs,
  }
}

/**
 * Every paginated JSM operation, wired to the tool it resolves to and the contract its route
 * parses the body with. This walks the real chain — block `tools.config.params` → the tool's
 * `request.body` → the route contract — which is exactly where `jsm_get_comments` broke: the
 * tools declare `start`/`limit` as `type: 'number'` while the contract demanded strings.
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

/** Run a set of block inputs through `tools.config.params`, then through the tool's request body. */
function buildRequestBody(
  { operation, buildBody, extraInputs }: PaginatedCase,
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

  return buildBody({ ...toolParams, accessToken: ACCESS_TOKEN, domain: DOMAIN })
}

describe.each(PAGINATED_CASES.map((testCase) => [testCase.operation, testCase] as const))(
  'JiraServiceManagementBlock %s',
  (_operation, testCase) => {
    it('resolves to the expected tool', () => {
      const toolFn = JiraServiceManagementBlock.tools.config?.tool
      expect(toolFn?.({ operation: testCase.operation })).toBe(testCase.toolId)
      expect(JiraServiceManagementBlock.tools.access).toContain(testCase.toolId)
    })

    it('sends a body its route contract accepts when pagination is filled in', () => {
      const body = buildRequestBody(testCase, { startIndex: '50', maxResults: '25' })

      expect(body.start).toBe(50)
      expect(body.limit).toBe(25)
      expect(testCase.schema.parse(body)).toMatchObject({ start: '50', limit: '25' })
    })

    it('sends a body its route contract accepts when pagination is left blank', () => {
      const body = buildRequestBody(testCase, {})

      expect(body.start).toBeUndefined()
      expect(body.limit).toBeUndefined()
      expect(() => testCase.schema.parse(body)).not.toThrow()
    })

    it('drops non-numeric pagination input instead of sending NaN', () => {
      const body = buildRequestBody(testCase, { startIndex: 'not-a-number', maxResults: '' })

      expect(body.start).toBeUndefined()
      expect(body.limit).toBeUndefined()
      expect(() => testCase.schema.parse(body)).not.toThrow()
    })
  }
)

describe('JiraServiceManagementBlock pagination inputs', () => {
  it('exposes Start Index and Max Results on exactly the paginated operations', () => {
    const operations = PAGINATED_CASES.map(({ operation }) => operation)

    for (const id of ['startIndex', 'maxResults']) {
      const subBlock = JiraServiceManagementBlock.subBlocks.find((sb) => sb.id === id)
      expect(subBlock, `${id} subBlock is missing`).toBeDefined()
      expect(subBlock?.mode).toBe('advanced')
      expect(subBlock?.condition).toEqual({ field: 'operation', value: operations })
      expect(JiraServiceManagementBlock.inputs[id]).toBeDefined()
    }
  })
})
