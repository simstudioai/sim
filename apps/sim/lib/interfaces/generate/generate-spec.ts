import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import {
  type ApiStartField,
  type InterfaceSpec,
  interfaceSpecSchema,
  toLlmInputSchema,
  validateInterfaceSpec,
} from '@/lib/interfaces'
import { extractAndParseJSON } from '@/providers/utils'

const logger = createLogger('GenerateInterfaceSpec')

function buildSystemPrompt(): string {
  return `You generate UI specs for Sim workflow interfaces.
Respond with ONLY a JSON object matching this schema (no markdown fences):
{
  "version": 1,
  "theme": { "primaryColor": "#hex or var(--name)", "density": "comfortable" | "compact" },
  "page": { "title": string, "description"?: string },
  "sections": [{ "id": string, "title"?: string, "controls": Control[] }],
  "actions": [{ "id": "run", "label": string, "variant": "primary", "submit": { "fieldMapping": {} } }],
  "messages": { "success"?: string, "error"?: string }
}
Control types: text, textarea, number, select, checkbox, markdown.
Bound controls need: type, id, label, bind (exact input field name), optional required/placeholder/options.
markdown controls need: type, id, content.
Rules:
- Exactly one action with id "run".
- Every required input field must be bound exactly once.
- Optional fields may be omitted.
- Do not invent field names that are not in the provided input schema.
- Prefer a clear primary button label.
- For empty input schemas, use empty sections and a single button action.
- primaryColor must be #RGB/#RRGGBB or var(--token).`
}

export async function generateInterfaceSpec(params: {
  workflowName: string
  workflowDescription?: string | null
  fields: ApiStartField[]
  brief?: string
  primaryColor?: string
  title?: string
}): Promise<{ success: true; spec: InterfaceSpec } | { success: false; error: string }> {
  // TODO: route through the provider layer / BYOK instead of a hardcoded OpenAI call
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'Interface generation is not configured' }
  }

  const llmFields = toLlmInputSchema(params.fields)
  const userPrompt = [
    `Workflow name: ${params.workflowName}`,
    params.workflowDescription ? `Workflow description: ${params.workflowDescription}` : null,
    params.title ? `Preferred title: ${params.title}` : null,
    params.primaryColor ? `Preferred primary color: ${params.primaryColor}` : null,
    params.brief ? `User brief: ${params.brief}` : null,
    `Input schema (names/types/required only): ${JSON.stringify(llmFields)}`,
    'Generate the InterfaceSpec JSON now.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error('OpenAI generate failed', { status: response.status, text })
      return { success: false, error: 'Failed to generate interface' }
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      return { success: false, error: 'Failed to generate interface' }
    }

    let raw: unknown
    try {
      raw = extractAndParseJSON(content)
    } catch {
      try {
        raw = JSON.parse(content)
      } catch {
        return { success: false, error: 'Failed to parse generated interface' }
      }
    }

    if (params.primaryColor && raw && typeof raw === 'object') {
      const obj = raw as { theme?: { primaryColor?: string } }
      obj.theme = { ...(obj.theme || {}), primaryColor: params.primaryColor }
    }

    const validated = validateInterfaceSpec(raw, params.fields)
    if (!validated.success || !validated.spec) {
      // One repair attempt: coerce through schema defaults if possible
      const coerced = interfaceSpecSchema.safeParse(raw)
      if (coerced.success) {
        const retry = validateInterfaceSpec(coerced.data, params.fields)
        if (retry.success && retry.spec) {
          return { success: true, spec: retry.spec }
        }
      }
      return { success: false, error: validated.error || 'Generated interface failed validation' }
    }

    return { success: true, spec: validated.spec }
  } catch (error) {
    logger.error('generateInterfaceSpec error', error)
    return { success: false, error: 'Failed to generate interface' }
  }
}
