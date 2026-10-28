import type { SandboxBroker, SandboxBrokerContext } from '@/lib/execution/sandbox/types'
import {
  testCancelArgsSchema,
  testJudgeArgsSchema,
  testNextArgsSchema,
  testProgressArgsSchema,
  testReplyArgsSchema,
  testStartArgsSchema,
} from '@/lib/workflow-tests/protocol'
import type { WorkflowTestSession } from '@/lib/workflow-tests/session'
import { requireWorkflowTestSession } from '@/lib/workflow-tests/session-registry'

/** The session this sandbox run belongs to, scoped to the broker context's workspace. */
function sessionFor(ctx: SandboxBrokerContext): WorkflowTestSession {
  const session = requireWorkflowTestSession(ctx.requestId)
  if (session.config.workspaceId !== ctx.workspaceId) {
    throw new Error('This workflow test run belongs to another workspace')
  }
  return session
}

const testPlan: SandboxBroker = {
  name: 'testPlan',
  async handle(ctx) {
    return { only: sessionFor(ctx).config.only }
  },
}

const testStart: SandboxBroker = {
  name: 'testStart',
  handle: (ctx, args) => sessionFor(ctx).start(testStartArgsSchema.parse(args)),
}

const testNext: SandboxBroker = {
  name: 'testNext',
  handle: (ctx, args) => sessionFor(ctx).next(testNextArgsSchema.parse(args).runId),
}

const testReply: SandboxBroker = {
  name: 'testReply',
  handle(ctx, args) {
    const reply = testReplyArgsSchema.parse(args)
    return sessionFor(ctx).reply(
      reply.runId,
      reply.callId,
      'error' in reply ? { error: reply.error } : { output: reply.output }
    )
  },
}

const testCancel: SandboxBroker = {
  name: 'testCancel',
  async handle(ctx, args) {
    sessionFor(ctx).cancel(testCancelArgsSchema.parse(args).runIds)
    return null
  },
}

const testJudge: SandboxBroker = {
  name: 'testJudge',
  handle: (ctx, args) => sessionFor(ctx).judge(testJudgeArgsSchema.parse(args)),
}

const testProgress: SandboxBroker = {
  name: 'testProgress',
  async handle(ctx, args) {
    await sessionFor(ctx).progress(testProgressArgsSchema.parse(args))
    return null
  },
}

export const workflowTestBrokers: ReadonlyArray<SandboxBroker> = [
  testPlan,
  testStart,
  testNext,
  testReply,
  testCancel,
  testJudge,
  testProgress,
]
