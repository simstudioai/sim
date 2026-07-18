import { z } from 'zod'
import { runDemoIsolatedAskPass } from '@/lib/apps/demo/headless-mothership'

export type FullstackFollowUpIntent = 'frontend' | 'backend' | 'both'
const followUpIntentSchema = z.enum(['frontend', 'backend', 'both'])
const followUpDecisionSchema = z.object({ intent: followUpIntentSchema }).strict()

const FRONTEND_PATTERNS =
  /\b(color|colour|button|style|css|layout|font|spacing|padding|margin|ui|ux|interface|frontend|screen|page|app\s+design|design|theme|dark\s*mode|avatar|image\s*size|make\s+the|look|polish|copy|text|label|heading|title\s+text|placeholder|hover|animation|border|radius|shadow|icon)\b/i

const BACKEND_PATTERNS =
  /\b(workflow|slack|tiktok|integrate|integration|action|api|oauth|credential|field|input|output|save|send|deploy|endpoint|trigger|block|connect|database|table|webhook|second\s+workflow|another\s+workflow|add\s+a\s+workflow)\b/i

/**
 * Schema-validated follow-up routing for the hosted Full-stack coordinator.
 * Defaults to `both` when uncertain so backend handoff stays fresh.
 */
export function classifyFullstackFollowUpIntent(prompt: string): FullstackFollowUpIntent {
  const trimmed = prompt.trim()
  if (!trimmed) return 'both'

  const frontendHit = FRONTEND_PATTERNS.test(trimmed)
  const backendHit = BACKEND_PATTERNS.test(trimmed)

  const candidate =
    frontendHit && !backendHit ? 'frontend' : backendHit && !frontendHit ? 'backend' : 'both'
  return followUpIntentSchema.parse(candidate)
}

export async function decideFullstackFollowUpIntent(params: {
  prompt: string
  userId: string
  workspaceId: string
  abortSignal?: AbortSignal
}): Promise<FullstackFollowUpIntent> {
  try {
    const result = await runDemoIsolatedAskPass({
      userId: params.userId,
      workspaceId: params.workspaceId,
      abortSignal: params.abortSignal,
      message: [
        'Classify one follow-up instruction for an existing Full-stack App.',
        'Respond with ONLY JSON: {"intent":"frontend"|"backend"|"both"}.',
        'frontend: visual design, interface, layout, styling, copy, components, or client-only behavior.',
        'backend: workflows, integrations, actions, data sources, API inputs/outputs, OAuth, or automation logic.',
        'both: explicitly changes both, or cannot be completed safely by only one side.',
        'Do not classify the word "app" alone as backend.',
        '',
        `Instruction:\n${params.prompt}`,
      ].join('\n'),
    })
    if (!result.success) return classifyFullstackFollowUpIntent(params.prompt)
    const candidate = result.content.trim().match(/\{[\s\S]*\}/)?.[0]
    if (!candidate) return classifyFullstackFollowUpIntent(params.prompt)
    return followUpDecisionSchema.parse(JSON.parse(candidate)).intent
  } catch {
    return classifyFullstackFollowUpIntent(params.prompt)
  }
}
