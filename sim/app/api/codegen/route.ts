import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('GenerateCodeAPI')

let openai: OpenAI | null = null
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
} else {
  logger.warn('OPENAI_API_KEY not found. Code generation API will not function.')
}

type GenerationType = 'json-schema' | 'javascript-function-body' | 'typescript-function-body'

interface RequestBody {
  prompt: string
  generationType: GenerationType
  context?: string
  stream?: boolean
}

const systemPrompts: Record<GenerationType, string> = {
  'json-schema': `You are an expert programmer specializing in creating JSON schemas for function tools.
Generate ONLY the JSON schema based on the user's request.
Follow the standard JSON Schema format.
The output must be a single, valid JSON object, starting with { and ending with }.
Do not include any explanations, markdown formatting, or other text outside the JSON object.
Schema example:
{
  "type": "function",
  "function": {
    "name": "getUserDetails",
    "description": "Fetches details for a specific user.",
    "parameters": {
      "type": "object",
      "properties": {
        "userId": {
          "type": "string",
          "description": "The unique identifier of the user."
        }
      },
      "required": ["userId"]
    }
  }
}`,
  'javascript-function-body': `You are an expert JavaScript programmer.
Generate ONLY the body of a JavaScript function based on the user's request.
The code should be executable within an async context. You have access to a 'params' object containing input parameters and 'environmentVariables' object for env vars.
Do not include the function signature (e.g., 'async function myFunction() {').
Do not include import/require statements unless absolutely necessary and they are standard Node.js modules.
Do not include markdown formatting or explanations.
Output only the raw JavaScript code.
Example:
const userId = params.userId;
const apiKey = environmentVariables.API_KEY;
const response = await fetch('https://api.example.com/users/' + userId, { headers: { Authorization: 'Bearer ' + apiKey } });
if (!response.ok) {
  throw new Error('Failed to fetch user data: ' + response.statusText);
}
const data = await response.json();
return data; // Ensure you return a value if expected`,
  'typescript-function-body': `You are an expert TypeScript programmer.
Generate ONLY the body of a TypeScript function based on the user's request.
The code should be executable within an async context. You have access to a 'params' object (typed as Record<string, any>) containing input parameters and an 'environmentVariables' object (typed as Record<string, string>) for env vars.
Do not include the function signature (e.g., 'async function myFunction(): Promise<any> {').
Do not include import/require statements unless absolutely necessary and they are standard Node.js modules.
Do not include markdown formatting or explanations.
Output only the raw TypeScript code. Use modern TypeScript features where appropriate. Do not use semicolons.
Example:
const userId = params.userId as string
const apiKey = environmentVariables.API_KEY
const response = await fetch(\`https://api.example.com/users/\${userId}\`, { headers: { Authorization: \`Bearer \${apiKey}\` } })
if (!response.ok) {
  throw new Error(\`Failed to fetch user data: \${response.statusText}\`)
}
const data: unknown = await response.json()
// Add type checking/assertion if necessary
return data // Ensure you return a value if expected`,
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  logger.info(`[${requestId}] Received code generation request`)

  if (!openai) {
    logger.error(`[${requestId}] OpenAI client not initialized. Missing API key.`)
    return NextResponse.json(
      { success: false, error: 'Code generation service is not configured.' },
      { status: 503 }
    )
  }

  try {
    const body = (await req.json()) as RequestBody

    const { prompt, generationType, context, stream = false } = body

    if (!prompt || !generationType) {
      logger.warn(`[${requestId}] Invalid request: Missing prompt or generationType.`)
      return NextResponse.json(
        { success: false, error: 'Missing required fields: prompt and generationType.' },
        { status: 400 }
      )
    }

    if (!systemPrompts[generationType]) {
      logger.warn(`[${requestId}] Invalid generationType: ${generationType}`)
      return NextResponse.json(
        { success: false, error: `Invalid generationType: ${generationType}` },
        { status: 400 }
      )
    }

    const systemPrompt = systemPrompts[generationType]
    const userMessage = context
      ? `Prompt: ${prompt}\n\nExisting Content/Context:\n${context}`
      : `Prompt: ${prompt}`

    logger.debug(`[${requestId}] Calling OpenAI API`, { generationType, stream })

    // For streaming responses
    if (stream) {
      const encoder = new TextEncoder()
      const streamResponse = new TransformStream()
      const writer = streamResponse.writable.getWriter()

      // Start streaming response
      const streamOpenAI = async () => {
        try {
          const stream = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.2,
            max_tokens: 1500,
            stream: true,
          })

          let fullContent = ''

          // Process each chunk
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullContent += content

              // Send the chunk to the client
              const payload = encoder.encode(
                JSON.stringify({
                  chunk: content,
                  done: false,
                }) + '\n'
              )

              await writer.write(payload)
            }
          }

          // Check JSON validity for json-schema type when streaming is complete
          if (generationType === 'json-schema') {
            try {
              JSON.parse(fullContent)
            } catch (parseError: any) {
              logger.error(`[${requestId}] Generated JSON schema is invalid`, {
                error: parseError.message,
                content: fullContent,
              })

              // Send error to client
              const errorPayload = encoder.encode(
                JSON.stringify({
                  error: 'Generated JSON schema was invalid.',
                  done: true,
                }) + '\n'
              )

              await writer.write(errorPayload)
              await writer.close()
              return
            }
          }

          // Send the final done message
          const donePayload = encoder.encode(
            JSON.stringify({
              done: true,
              fullContent: fullContent,
            }) + '\n'
          )

          await writer.write(donePayload)
          await writer.close()

          logger.info(`[${requestId}] Code generation streaming completed`, { generationType })
        } catch (error: any) {
          logger.error(`[${requestId}] Streaming error`, {
            error: error.message || 'Unknown error',
            stack: error.stack,
          })

          const errorMessage =
            error instanceof OpenAI.APIError ? error.message : 'Code generation streaming failed'

          // Send error to client
          const errorPayload = encoder.encode(
            JSON.stringify({
              error: errorMessage,
              done: true,
            }) + '\n'
          )

          await writer.write(errorPayload)
          await writer.close()
        }
      }

      // Start streaming asynchronously
      streamOpenAI()

      return new Response(streamResponse.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // For non-streaming responses (original implementation)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: generationType === 'json-schema' ? { type: 'json_object' } : undefined,
    })

    const generatedContent = completion.choices[0]?.message?.content?.trim()

    if (!generatedContent) {
      logger.error(`[${requestId}] OpenAI response was empty or invalid.`)
      return NextResponse.json(
        { success: false, error: 'Failed to generate content. OpenAI response was empty.' },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Code generation successful`, { generationType })

    if (generationType === 'json-schema') {
      try {
        JSON.parse(generatedContent)
        return NextResponse.json({ success: true, generatedContent })
      } catch (parseError: any) {
        logger.error(`[${requestId}] Generated JSON schema is invalid`, {
          error: parseError.message,
          content: generatedContent,
        })
        return NextResponse.json(
          { success: false, error: 'Generated JSON schema was invalid.' },
          { status: 500 }
        )
      }
    } else {
      return NextResponse.json({ success: true, generatedContent })
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Code generation failed`, {
      error: error.message || 'Unknown error',
      stack: error.stack,
    })

    let status = 500
    let message = 'Code generation failed'
    if (error instanceof OpenAI.APIError) {
      status = error.status || 500
      message = error.message
      logger.error(`[${requestId}] OpenAI API Error: ${status} - ${message}`)
    }

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status }
    )
  }
}
