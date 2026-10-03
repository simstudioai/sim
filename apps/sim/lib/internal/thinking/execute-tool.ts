import { z } from 'zod'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import type { ThinkingToolResponse } from '@/tools/thinking/types'

const thinkingInputSchema = z.object({
  thought: z.string().min(1, 'The thought parameter is required and must be a string'),
})

export const executeThinkingTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  if (toolId !== 'thinking_tool') {
    return Response.json({ error: `Unsupported Thinking tool: ${toolId}` }, { status: 500 })
  }

  const parsed = thinkingInputSchema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid thinking input' },
      { status: 400 }
    )
  }

  return Response.json({
    success: true,
    output: { acknowledgedThought: parsed.data.thought },
  } satisfies ThinkingToolResponse)
}
