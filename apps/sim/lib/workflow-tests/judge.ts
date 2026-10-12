import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { z } from 'zod'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import { EVALUATOR } from '@/executor/constants'
import { executeProviderRequest } from '@/providers'
import { resolveProxiedModelCost } from '@/providers/cost-policy'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('WorkflowTestJudge')

const JUDGE_MODEL = EVALUATOR.DEFAULT_MODEL

const JUDGE_SYSTEM_PROMPT = [
  'You check one output against one requirement for an automated test.',
  'Judge only what the requirement states, and pass only if every part of it holds.',
  'In reason, quote the part of the output your verdict rests on, in one or two sentences.',
].join(' ')

const verdictSchema = z.object({ pass: z.boolean(), reason: z.string().trim().min(1) })
export type JudgeVerdict = z.infer<typeof verdictSchema>

export interface JudgeRubricInput {
  workspaceId: string
  actorUserId: string
  value: string
  rubric: string
  abortSignal: AbortSignal
}

/** One pass/fail model call for `toMatchRubric`, billed to the workspace like a wand call. */
export async function judgeRubric(input: JudgeRubricInput): Promise<JudgeVerdict> {
  const billingAttribution = await resolveBillingAttribution({
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
  })
  const usage = await checkAttributedUsageLimits(billingAttribution)
  if (usage.isExceeded) throw new Error(usage.message || 'Usage limit exceeded')
  await validateModelProvider(input.actorUserId, input.workspaceId, JUDGE_MODEL)

  const response = await executeProviderRequest(getProviderFromModel(JUDGE_MODEL), {
    model: JUDGE_MODEL,
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Requirement:\n${input.rubric}\n\nOutput:\n${input.value}`,
      },
    ],
    responseFormat: {
      name: 'test_verdict',
      schema: {
        type: 'object',
        properties: { pass: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['pass', 'reason'],
        additionalProperties: false,
      },
      strict: true,
    },
    temperature: 0,
    workspaceId: input.workspaceId,
    abortSignal: input.abortSignal,
  })
  if (!('content' in response) || typeof response.content !== 'string') {
    throw new Error('The judge did not return a verdict')
  }

  const cost = resolveProxiedModelCost(response.cost)
  await recordUsage({
    userId: billingAttribution.actorUserId,
    workspaceId: input.workspaceId,
    ...toBillingContext(billingAttribution),
    entries: [
      {
        category: 'model',
        source: 'workflow-test',
        description: JUDGE_MODEL,
        cost: cost.total,
        sourceReference: `workflow-test-judge:${generateShortId()}`,
        metadata: {
          inputTokens: response.tokens?.input ?? 0,
          outputTokens: response.tokens?.output ?? 0,
        },
      },
    ],
  })
  await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)

  let parsed: unknown
  try {
    parsed = JSON.parse(response.content)
  } catch {
    logger.warn('Judge returned non-JSON content', { length: response.content.length })
    throw new Error('The judge returned an unreadable verdict')
  }
  const verdict = verdictSchema.safeParse(parsed)
  if (!verdict.success) throw new Error('The judge returned an unreadable verdict')
  return verdict.data
}
