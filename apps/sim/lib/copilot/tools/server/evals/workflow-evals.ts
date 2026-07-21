import { omit } from '@sim/utils/object'
import { z } from 'zod'
import {
  archiveWorkflowEvalSuiteInputSchema,
  createWorkflowEvalSuiteInputSchema,
  updateWorkflowEvalSuiteInputSchema,
} from '@/lib/api/contracts/workflow-evals'
import {
  ArchiveWorkflowEvalSuite,
  CreateWorkflowEvalSuite,
  GetWorkflowEvalRun,
  GetWorkflowEvalSuite,
  ListWorkflowEvalSuites,
  RunWorkflowEvalSuite,
  RunWorkflowEvalTest,
  StopWorkflowEvalRun,
  UpdateWorkflowEvalSuite,
} from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { authorizeWorkflowEvalAccess } from '@/lib/workflows/evals/access'
import { loadWorkflowEvalRunDetail } from '@/lib/workflows/evals/run-detail-loader'
import {
  startWorkflowEvalSuiteRun,
  startWorkflowEvalTestRun,
  stopWorkflowEvalRun,
} from '@/lib/workflows/evals/run-service'
import {
  archiveWorkflowEvalSuite,
  createWorkflowEvalSuite,
  getWorkflowEvalSuite,
  listWorkflowEvalSuites,
  updateWorkflowEvalSuite,
} from '@/lib/workflows/evals/suite-service'

const workflowIdSchema = z.string().trim().min(1).max(128).optional()
const idSchema = z.string().trim().min(1).max(128)
const injectedEvalContextSchema = z
  .object({
    chatId: idSchema.optional(),
    workspaceId: idSchema.optional(),
  })
  .strict()

function stripInjectedEvalContext(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const record = value as Record<string, unknown>
  injectedEvalContextSchema.parse({
    chatId: record.chatId,
    workspaceId: record.workspaceId,
  })
  return omit(record, ['chatId', 'workspaceId'])
}

function acceptInjectedEvalContext<TOutput>(schema: z.ZodType<TOutput>): z.ZodType<TOutput> {
  return z.preprocess(stripInjectedEvalContext, schema)
}

const listArgsSchema = acceptInjectedEvalContext(
  z
    .object({
      workflowId: workflowIdSchema,
      includeArchived: z.boolean().optional().default(false),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      cursor: z.string().trim().min(1).max(2_000).optional(),
    })
    .strict()
)

const getSuiteArgsSchema = acceptInjectedEvalContext(
  z
    .object({
      workflowId: workflowIdSchema,
      suiteId: idSchema,
      testIds: z.array(idSchema).min(1).max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      cursor: z.string().trim().min(1).max(2_000).optional(),
    })
    .strict()
)

const runSuiteArgsSchemaBase = z
  .object({
    workflowId: workflowIdSchema,
    suiteId: idSchema,
    expectedDefinitionRevision: z.coerce.number().int().min(1),
  })
  .strict()

const runSuiteArgsSchema = acceptInjectedEvalContext(runSuiteArgsSchemaBase)

const runTestArgsSchema = acceptInjectedEvalContext(
  runSuiteArgsSchemaBase
    .extend({
      testId: idSchema,
    })
    .strict()
)

const getRunArgsSchema = acceptInjectedEvalContext(
  z
    .object({
      workflowId: workflowIdSchema,
      suiteId: idSchema,
      runId: idSchema,
      view: z.enum(['summary', 'failures', 'all']).optional().default('all'),
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      cursor: z.string().trim().min(1).max(2_000).optional(),
    })
    .strict()
)

const stopRunArgsSchema = acceptInjectedEvalContext(
  z
    .object({
      workflowId: workflowIdSchema,
      suiteId: idSchema,
      runId: idSchema,
    })
    .strict()
)

const createArgsSchema = acceptInjectedEvalContext(createWorkflowEvalSuiteInputSchema)
const updateArgsSchema = acceptInjectedEvalContext(updateWorkflowEvalSuiteInputSchema)
const archiveArgsSchema = acceptInjectedEvalContext(archiveWorkflowEvalSuiteInputSchema)

function requireContext(context?: ServerToolContext): { userId: string; workspaceId?: string } {
  if (!context?.userId) throw new Error('Unauthorized access')
  return { userId: context.userId, workspaceId: context.workspaceId }
}

function requireWorkflowId(workflowId: string | undefined): string {
  if (!workflowId) throw new Error('workflowId is required when no active workflow is in context')
  return workflowId
}

async function authorize(
  workflowId: string | undefined,
  action: 'read' | 'write',
  context?: ServerToolContext
) {
  const caller = requireContext(context)
  return authorizeWorkflowEvalAccess({
    workflowId: requireWorkflowId(workflowId),
    userId: caller.userId,
    action,
    expectedWorkspaceId: caller.workspaceId,
  })
}

export const listWorkflowEvalSuitesServerTool: BaseServerTool<
  z.output<typeof listArgsSchema>,
  unknown
> = {
  name: ListWorkflowEvalSuites.id,
  inputSchema: listArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'read', context)
    return listWorkflowEvalSuites({
      workflowId: access.workflowId,
      includeArchived: args.includeArchived,
      limit: args.limit,
      cursor: args.cursor,
    })
  },
}

export const getWorkflowEvalSuiteServerTool: BaseServerTool<
  z.output<typeof getSuiteArgsSchema>,
  unknown
> = {
  name: GetWorkflowEvalSuite.id,
  inputSchema: getSuiteArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'read', context)
    return getWorkflowEvalSuite({
      workflowId: access.workflowId,
      suiteId: args.suiteId,
      testIds: args.testIds,
      limit: args.limit,
      cursor: args.cursor,
    })
  },
}

export const createWorkflowEvalSuiteServerTool: BaseServerTool<
  z.output<typeof createArgsSchema>,
  unknown
> = {
  name: CreateWorkflowEvalSuite.id,
  inputSchema: createArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'write', context)
    assertServerToolNotAborted(context, 'User stopped before the Eval suite was created')
    return createWorkflowEvalSuite({
      workflowId: access.workflowId,
      workspaceId: access.workspaceId,
      userId: access.userId,
      input: args,
    })
  },
}

export const updateWorkflowEvalSuiteServerTool: BaseServerTool<
  z.output<typeof updateArgsSchema>,
  unknown
> = {
  name: UpdateWorkflowEvalSuite.id,
  inputSchema: updateArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'write', context)
    return updateWorkflowEvalSuite({
      workflowId: access.workflowId,
      workspaceId: access.workspaceId,
      userId: access.userId,
      input: args,
      assertNotAborted: () =>
        assertServerToolNotAborted(context, 'User stopped before the Eval suite update committed'),
    })
  },
}

export const archiveWorkflowEvalSuiteServerTool: BaseServerTool<
  z.output<typeof archiveArgsSchema>,
  unknown
> = {
  name: ArchiveWorkflowEvalSuite.id,
  inputSchema: archiveArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'write', context)
    const result = await archiveWorkflowEvalSuite({
      workflowId: access.workflowId,
      workspaceId: access.workspaceId,
      userId: access.userId,
      suiteId: args.suiteId,
      expectedDefinitionRevision: args.expectedDefinitionRevision,
      assertNotAborted: () =>
        assertServerToolNotAborted(context, 'User stopped before the Eval suite archive committed'),
    })
    return { ...result, workflowId: access.workflowId }
  },
}

export const runWorkflowEvalSuiteServerTool: BaseServerTool<
  z.output<typeof runSuiteArgsSchema>,
  unknown
> = {
  name: RunWorkflowEvalSuite.id,
  inputSchema: runSuiteArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'write', context)
    assertServerToolNotAborted(context, 'User stopped before the Eval suite run was queued')
    return startWorkflowEvalSuiteRun({
      workflowId: access.workflowId,
      suiteId: args.suiteId,
      workspaceId: access.workspaceId,
      userId: access.userId,
      expectedDefinitionRevision: args.expectedDefinitionRevision,
    })
  },
}

export const runWorkflowEvalTestServerTool: BaseServerTool<
  z.output<typeof runTestArgsSchema>,
  unknown
> = {
  name: RunWorkflowEvalTest.id,
  inputSchema: runTestArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'write', context)
    assertServerToolNotAborted(context, 'User stopped before the Eval test run was queued')
    return startWorkflowEvalTestRun({
      workflowId: access.workflowId,
      suiteId: args.suiteId,
      testId: args.testId,
      workspaceId: access.workspaceId,
      userId: access.userId,
      expectedDefinitionRevision: args.expectedDefinitionRevision,
    })
  },
}

export const getWorkflowEvalRunServerTool: BaseServerTool<
  z.output<typeof getRunArgsSchema>,
  unknown
> = {
  name: GetWorkflowEvalRun.id,
  inputSchema: getRunArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'read', context)
    return loadWorkflowEvalRunDetail({
      workflowId: access.workflowId,
      suiteId: args.suiteId,
      runId: args.runId,
      view: args.view,
      limit: args.limit,
      cursor: args.cursor,
    })
  },
}

export const stopWorkflowEvalRunServerTool: BaseServerTool<
  z.output<typeof stopRunArgsSchema>,
  unknown
> = {
  name: StopWorkflowEvalRun.id,
  inputSchema: stopRunArgsSchema,
  outputSchema: z.unknown(),
  async execute(args, context) {
    const access = await authorize(args.workflowId, 'write', context)
    assertServerToolNotAborted(context, 'User stopped before the Eval run cancellation committed')
    return stopWorkflowEvalRun({
      workflowId: access.workflowId,
      suiteId: args.suiteId,
      runId: args.runId,
      workspaceId: access.workspaceId,
      userId: access.userId,
    })
  },
}
