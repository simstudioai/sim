import { NextResponse } from 'next/server'
import { OpenAI } from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CopilotAPI')

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

const RequestSchema = z.object({
  messages: z.array(MessageSchema),
  workflowState: z.object({
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
  }),
})

const workflowActions = {
  addBlock: {
    description: 'Add one new block to the workflow',
    parameters: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          enum: ['agent', 'api', 'condition', 'function', 'router'],
          description: 'The type of block to add',
        },
        name: {
          type: 'string',
          description:
            'Optional custom name for the block. Do not provide a name unless the user has specified it.',
        },
        position: {
          type: 'object',
          description:
            'Optional position for the block. Do not provide a position unless the user has specified it.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
        },
      },
    },
  },
  addEdge: {
    description: 'Create a connection (edge) between two blocks',
    parameters: {
      type: 'object',
      required: ['sourceId', 'targetId'],
      properties: {
        sourceId: {
          type: 'string',
          description: 'ID of the source block',
        },
        targetId: {
          type: 'string',
          description: 'ID of the target block',
        },
        sourceHandle: {
          type: 'string',
          description: 'Optional handle identifier for the source connection point',
        },
        targetHandle: {
          type: 'string',
          description: 'Optional handle identifier for the target connection point',
        },
      },
    },
  },
  removeBlock: {
    description: 'Remove a block from the workflow',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'ID of the block to remove' },
      },
    },
  },
  removeEdge: {
    description: 'Remove a connection (edge) between blocks',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'ID of the edge to remove' },
      },
    },
  },
}

// System prompt that references workflow state
const getSystemPrompt = (workflowState: any) => {
  const blockCount = Object.keys(workflowState.blocks).length
  const edgeCount = workflowState.edges.length

  // Create a summary of existing blocks
  const blockSummary = Object.values(workflowState.blocks)
    .map((block: any) => `- ${block.type} block named "${block.name}" with id ${block.id}`)
    .join('\n')

  // Create a summary of existing edges
  const edgeSummary = workflowState.edges
    .map((edge: any) => `- ${edge.source} -> ${edge.target} with id ${edge.id}`)
    .join('\n')

  return `You are a workflow assistant that helps users modify their workflow by adding/removing blocks and connections.

Current Workflow State:
${
  blockCount === 0
    ? 'The workflow is empty.'
    : `${blockSummary}

Connections:
${edgeCount === 0 ? 'No connections between blocks.' : edgeSummary}`
}

When users request changes:
- Consider existing blocks when suggesting connections
- Provide clear feedback about what actions you've taken

Use the following functions to modify the workflow:
1. Use the addBlock function to create a new block
2. Use the addEdge function to connect one block to another
3. Use the removeBlock function to remove a block
4. Use the removeEdge function to remove a connection

Only use the provided functions and respond naturally to the user's requests.`
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Validate API key
    const apiKey = request.headers.get('X-OpenAI-Key')
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key is required' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validatedData = RequestSchema.parse(body)
    const { messages, workflowState } = validatedData

    // Initialize OpenAI client
    const openai = new OpenAI({ apiKey })

    // Create message history with workflow context
    const messageHistory = [
      { role: 'system', content: getSystemPrompt(workflowState) },
      ...messages,
    ]

    // Make OpenAI API call with workflow context
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messageHistory as ChatCompletionMessageParam[],
      tools: Object.entries(workflowActions).map(([name, config]) => ({
        type: 'function',
        function: {
          name,
          description: config.description,
          parameters: config.parameters,
        },
      })),
      tool_choice: 'auto',
    })

    const message = completion.choices[0].message

    // Process tool calls if present
    if (message.tool_calls) {
      logger.debug(`[${requestId}] Tool calls:`, {
        toolCalls: message.tool_calls,
      })
      const actions = message.tool_calls.map((call) => ({
        name: call.function.name,
        parameters: JSON.parse(call.function.arguments),
      }))

      return NextResponse.json({
        message: message.content || "I've updated the workflow based on your request.",
        actions,
      })
    }

    // Return response with no actions
    return NextResponse.json({
      message:
        message.content ||
        "I'm not sure what changes to make to the workflow. Can you please provide more specific instructions?",
    })
  } catch (error) {
    logger.error(`[${requestId}] Copilot API error:`, { error })

    // Handle specific error types
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request format', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Failed to process copilot message' }, { status: 500 })
  }
}
