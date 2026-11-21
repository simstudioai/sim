import {
  WORKSPACE_SOURCE_LIMITS,
  WORKSPACE_SOURCE_STAGE_MAX_BYTES,
} from '@sim/workspace-code/limits'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2ApplyWorkspaceSourceContract,
  v2FindMissingWorkspaceSourceBlobsContract,
  v2GetWorkspaceSourceContract,
  v2PlanWorkspaceSourceContract,
  v2StageWorkspaceSourceBlobsContract,
  v2StageWorkspaceSourceBlobsFormSchema,
} from '@/lib/api/contracts/v2/workspace-source'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const TABLE_ID = 'tbl_5c0e2a7b9d1f4e3a8b6c2d0f7e9a1b3c'
const SHA256_EXAMPLE = '9f2c4e6a8b0d1f3e5a7c9b2d4f6e8a0c1b3d5f7e9a2c4b6d8f0e1a3c5b7d9f2e'
const FINGERPRINT = 'rf1:4b8d2f6a0c3e7b1d5f9a2c6e0b4d8f3a7c1e5b9d2f6a0c4e8b3d7f1a5c9e2b6d'

const LEADS_TS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true, unique: true }),
    status: column.select({ options: ['new', 'won'] }),
  },
})
`

const BASE_EXAMPLE = {
  version: 1,
  workspaceId: WORKSPACE_ID,
  resources: {
    'table:leads': {
      id: TABLE_ID,
      fingerprint: FINGERPRINT,
      columns: {
        email: { id: 'col_8e1c4a7b2d5f' },
        status: { id: 'col_3b6d9f2a5c8e', options: { new: 'k2Pq9x', won: 'r7Tn4m' } },
      },
    },
  },
}

export const workspaceSourceOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetWorkspaceSourceContract,
    {
      applicationOperation: workspaceSourceOperations.read,
      operationId: 'getWorkspaceSource',
      summary: 'Get workspace source',
      description: `Read the workspace as a source directory: \`secrets.ts\` (secret names, never values) and \`credentials.ts\` (credential keys, never tokens), one declaration file per MCP server (\`mcp/<key>.ts\`), per deployment (\`deployments/<workflow key>.ts\`), per table (\`tables/<key>.ts\`), per custom tool (\`tools/<key>.ts\`, its code in \`tools/<key>.js\`) and per skill (\`skills/<key>.md\`), one folder per knowledge base (\`knowledge/<key>/\`, its settings beside its documents in \`docs/\`) and per workflow (\`workflows/<key>/\`, exactly as Get Workflow Source prints it, with its lock and base), every workspace file under \`files/\`, the binary files (workspace files and knowledge documents) listed by hash with an \`href\` to download each, and \`base\`, which binds each resource key to its id and records each resource's fingerprint. Each resource appears by its resource key: allocated from its name the first time source names it, then never changed. \`kinds\` narrows the read; the directory then manages only those kinds. A resource left out (too large to read as source, not readable by the caller, or past the directory's declaration or binary-file budget) is listed in \`skipped\` with why, and a kind holding more than ${WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind} resources is left out with \`E_LIMIT_EXCEEDED\`. A table's rows are part of source only when its declaration opts in with \`rows\` (\`tables/<key>.rows.jsonl\`, at most ${WORKSPACE_SOURCE_LIMITS.maxTableRows} rows each); environment values and credentials never are. This read records no audit event. Returns \`403\` while workflows as code is not enabled.`,
      tags: ['Workflows'],
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace as source.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceSourceContract.params,
        'GetWorkspaceSourceParams',
        'Get workspace source path parameters',
        'Workspace to read.'
      ),
      query: documentedSchema(
        v2GetWorkspaceSourceContract.query,
        'GetWorkspaceSourceQuery',
        'Get workspace source query',
        'Which kinds to read.'
      ),
      response: documentedSchema(
        v2GetWorkspaceSourceContract.response.schema,
        'GetWorkspaceSourceResponse',
        'Get workspace source response',
        'The workspace as a source directory.',
        [
          {
            data: {
              workspaceId: WORKSPACE_ID,
              kinds: ['table', 'workflow'],
              files: { 'tables/leads.ts': LEADS_TS },
              blobs: [],
              base: BASE_EXAMPLE,
              skipped: [],
              diagnostics: [],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ApplyWorkspaceSourceContract,
    {
      applicationOperation: workspaceSourceOperations.apply,
      operationId: 'applyWorkspaceSource',
      summary: 'Apply workspace source',
      description: `Apply a workspace source directory: create and update what it declares, in dependency order (custom tools, skills, tables, knowledge bases and files before the workflows that use them). Send the files of every managed kind, \`kinds\` (the kind folders the directory holds), the binary-file manifest (path, SHA-256 and size), and the \`base\` from Get Workspace Source. Binary bytes are staged first and the apply names them by hash: \`sim workspaces source apply\` stages them itself, and other clients find the ones the server lacks (Find Missing Workspace Source Blobs) and upload them to \`POST /api/v2/workspaces/{workspaceId}/source/blobs\`, a binary upload MCP clients cannot send. A directory without binary files needs no staging; a write whose bytes are not staged refuses the whole apply with \`E_BLOB_MISSING\` before anything is written, and a dry run lists those paths in \`needBlobs\`. Requires workspace write access.\n\nThe whole plan is checked and authorized before anything is written: any error returns \`400\` with \`details.code\` \`SOURCE_REJECTED\` and \`details.diagnostics\` (each with a file, line and column), and nothing is written. A resource changed on the server since the directory was read returns \`409\` (\`SOURCE_STALE\`); another apply still writing the workspace \`409\` (\`SOURCE_BUSY\`: nothing was written, apply again once it finished; a dry run never waits on one); a schema-locked table \`423\`; a directory over a size limit \`413\` (at most ${WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind} resources per kind, ${WORKSPACE_SOURCE_LIMITS.maxWorkflows} workflows and ${WORKSPACE_SOURCE_LIMITS.maxChanges} changes per apply). A resource, table column or option the directory no longer declares is deleted only with \`options.allowDelete\`; without it, deleting one the base records is refused, and a server resource the base never recorded is kept with a warning. Each change is written by the operation that owns it and audited by it; workflow, skill, secret and deployment changes follow use cases a workspace API key cannot call, so a workspace API key gets \`E_APPLY_FORBIDDEN\` for those kinds (narrow the apply with \`options.only\`). Writes commit one by one: a write that fails mid-apply answers \`200\` with \`failed\` and the changes written before it, and applying the same directory again continues. The response carries the files re-printed from what was saved and the next \`base\`. \`dryRun=true\` plans, checks and authorizes without writing and answers \`200\` with the findings in \`diagnostics\`. Returns \`403\` while workflows as code is not enabled.`,
      tags: ['Workflows'],
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The applied (or planned) changes.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ApplyWorkspaceSourceContract.params,
        'ApplyWorkspaceSourceParams',
        'Apply workspace source path parameters',
        'Workspace to apply to.'
      ),
      query: documentedSchema(
        v2ApplyWorkspaceSourceContract.query,
        'ApplyWorkspaceSourceQuery',
        'Apply workspace source query',
        'Whether to plan without writing.'
      ),
      body: documentedSchema(
        v2ApplyWorkspaceSourceContract.body,
        'ApplyWorkspaceSourceBody',
        'Apply workspace source body',
        'The directory files, its managed kinds and the base they were read with.',
        [{ files: { 'tables/leads.ts': LEADS_TS }, kinds: ['table'], base: BASE_EXAMPLE }]
      ),
      response: documentedSchema(
        v2ApplyWorkspaceSourceContract.response.schema,
        'ApplyWorkspaceSourceResponse',
        'Apply workspace source response',
        'The plan, what was written, and the files re-printed from it.',
        [
          {
            data: {
              workspaceId: WORKSPACE_ID,
              dryRun: false,
              plan: [{ kind: 'table', key: 'leads', action: 'noop', id: TABLE_ID }],
              applied: [],
              needBlobs: [],
              files: {},
              base: BASE_EXAMPLE,
              diagnostics: [],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2PlanWorkspaceSourceContract,
    {
      applicationOperation: workspaceSourceOperations.plan,
      operationId: 'planWorkspaceSource',
      summary: 'Plan workspace source',
      description:
        'Report what Apply Workspace Source would do with this directory, without writing: every planned change and finding, exactly as `dryRun=true` reports them (a resource changed on the server since the directory was read included). A read: it needs only workspace read access, draws on the source-plan budget, one unit per workflow folder it evaluates as an apply does, takes no apply lease or apply slot and records no audit event, so `sim workspaces source status` never spends the source-write budget or holds up an apply. A server already running as many plans as it allows answers `429`. Each change is still checked by the operation that owns it, so a change the caller may not write is reported as refused. The body is an apply body without `provenance`. Returns `403` while workflows as code is not enabled.',
      tags: ['Workflows'],
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The planned changes.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2PlanWorkspaceSourceContract.params,
        'PlanWorkspaceSourceParams',
        'Plan workspace source path parameters',
        'Workspace the plan is for.'
      ),
      query: documentedSchema(
        v2PlanWorkspaceSourceContract.query,
        'PlanWorkspaceSourceQuery',
        'Plan workspace source query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2PlanWorkspaceSourceContract.body,
        'PlanWorkspaceSourceBody',
        'Plan workspace source body',
        'The directory files, its managed kinds and the base they were read with.',
        [{ files: { 'tables/leads.ts': LEADS_TS }, kinds: ['table'], base: BASE_EXAMPLE }]
      ),
      response: documentedSchema(
        v2PlanWorkspaceSourceContract.response.schema,
        'PlanWorkspaceSourceResponse',
        'Plan workspace source response',
        'The plan an apply would carry out.',
        [
          {
            data: {
              workspaceId: WORKSPACE_ID,
              dryRun: true,
              plan: [{ kind: 'table', key: 'leads', action: 'noop', id: TABLE_ID }],
              applied: [],
              needBlobs: [],
              files: {},
              base: BASE_EXAMPLE,
              diagnostics: [],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2FindMissingWorkspaceSourceBlobsContract,
    {
      applicationOperation: workspaceSourceOperations.findMissingBlobs,
      operationId: 'findMissingWorkspaceSourceBlobs',
      summary: 'Find missing workspace source blobs',
      description: `List which binary files of a workspace source directory the caller has not staged in this workspace, by SHA-256, so a client stages only those; an interrupted upload resumes without resending what is already staged. Asking renews nothing: staged bytes expire a day after they were last staged, and one that expires within the hour is listed as missing, so the client stages it again before applying. Staging is per caller (a person, or one workspace API key). Requires workspace write access. Returns \`403\` while workflows as code is not enabled.`,
      tags: ['Workflows'],
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The binary files still to stage.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2FindMissingWorkspaceSourceBlobsContract.params,
        'FindMissingWorkspaceSourceBlobsParams',
        'Find missing workspace source blobs path parameters',
        'Workspace the apply will target.'
      ),
      query: documentedSchema(
        v2FindMissingWorkspaceSourceBlobsContract.query,
        'FindMissingWorkspaceSourceBlobsQuery',
        'Find missing workspace source blobs query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2FindMissingWorkspaceSourceBlobsContract.body,
        'FindMissingWorkspaceSourceBlobsBody',
        'Find missing workspace source blobs body',
        'The binary files an apply will need.',
        [{ blobs: [{ sha256: SHA256_EXAMPLE, size: 18432 }] }]
      ),
      response: documentedSchema(
        v2FindMissingWorkspaceSourceBlobsContract.response.schema,
        'FindMissingWorkspaceSourceBlobsResponse',
        'Find missing workspace source blobs response',
        'The SHA-256 of each binary file still to stage.',
        [{ data: { workspaceId: WORKSPACE_ID, missing: [SHA256_EXAMPLE] } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2StageWorkspaceSourceBlobsContract,
    {
      applicationOperation: workspaceSourceOperations.stageBlobs,
      operationId: 'stageWorkspaceSourceBlobs',
      summary: 'Stage workspace source blobs',
      description: `Stage the bytes of binary files (workspace files, knowledge documents) for a workspace source apply, as multipart form data: one file part per blob, its field name the SHA-256 of its bytes. At most ${WORKSPACE_SOURCE_LIMITS.maxBlobsPerRequest} files and ${WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest} bytes per request, ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes} bytes per file; a larger file goes in a request of its own. A body over ${WORKSPACE_SOURCE_STAGE_MAX_BYTES} bytes answers \`413\` (\`PAYLOAD_TOO_LARGE\`) before it is read. A part whose bytes hash to another SHA-256 refuses the whole request (\`400\`), nothing staged. Staged files are scoped to the workspace and the caller, capped at ${WORKSPACE_SOURCE_LIMITS.maxStagedBlobs} files and ${WORKSPACE_SOURCE_LIMITS.maxStagedBytes} bytes (\`413\` with \`details.code\` \`SOURCE_STAGING_FULL\` past either), count against the workspace payer's storage quota while held (\`413\` with \`SOURCE_STAGING_FULL\` past it) until an apply writes them into the workspace, and expire a day after they were last staged; asking for them or applying with them never renews them, and an apply does not remove them. Staging the same bytes again renews them, and once an apply wrote them makes them count against the quota again, so it can answer \`SOURCE_STAGING_FULL\` too. Requires workspace write access. Returns \`403\` while workflows as code is not enabled.`,
      tags: ['Workflows'],
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The binary files staged.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2StageWorkspaceSourceBlobsContract.params,
        'StageWorkspaceSourceBlobsParams',
        'Stage workspace source blobs path parameters',
        'Workspace the apply will target.'
      ),
      query: documentedSchema(
        v2StageWorkspaceSourceBlobsContract.query,
        'StageWorkspaceSourceBlobsQuery',
        'Stage workspace source blobs query',
        'No query parameters.'
      ),
      requestBody: {
        schema: documentedSchema(
          v2StageWorkspaceSourceBlobsFormSchema,
          'StageWorkspaceSourceBlobsForm',
          'Stage workspace source blobs form',
          'One file part per binary file, named by its SHA-256.'
        ),
        contentTypes: ['multipart/form-data'],
      },
      response: documentedSchema(
        v2StageWorkspaceSourceBlobsContract.response.schema,
        'StageWorkspaceSourceBlobsResponse',
        'Stage workspace source blobs response',
        'The binary files now staged.',
        [{ data: { workspaceId: WORKSPACE_ID, staged: [{ sha256: SHA256_EXAMPLE, size: 18432 }] } }]
      ),
    }
  ),
]
