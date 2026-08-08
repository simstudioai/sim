/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as snowflakeTools from '@/tools/snowflake'
import type { ToolConfig } from '@/tools/types'

interface DocumentedParam {
  type: string
  required: 'Yes' | 'No'
  description: string
}

const docs = readFileSync(
  new URL('../../docs/content/docs/en/integrations/snowflake.mdx', import.meta.url),
  'utf8'
)

function registeredSnowflakeTools(): ToolConfig[] {
  return Object.values(snowflakeTools)
    .filter(
      (value): value is ToolConfig =>
        typeof value === 'object' && value !== null && 'id' in value && 'request' in value
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

function escapeMdxCell(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function expectedParams(tool: ToolConfig): Record<string, DocumentedParam> {
  return Object.fromEntries(
    Object.entries(tool.params).flatMap(([name, param]) => {
      if (!param || param.visibility === 'hidden') return []
      return [
        [
          name,
          {
            type: param.type,
            required: param.required === true ? 'Yes' : 'No',
            description: escapeMdxCell(param.description ?? ''),
          },
        ] as const,
      ]
    })
  )
}

function documentedParams(tool: ToolConfig): Record<string, DocumentedParam> {
  const marker = `### ${tool.name}\n`
  const actionStart = docs.indexOf(marker)
  if (actionStart === -1) throw new Error(`Missing generated action section for ${tool.id}`)

  const remaining = docs.slice(actionStart + marker.length)
  const nextAction = remaining.search(/\n### /)
  const action = nextAction === -1 ? remaining : remaining.slice(0, nextAction)
  const input = action.match(/#### Input\n\n([\s\S]*?)\n\n#### Output/)?.[1]
  if (!input) throw new Error(`Missing generated input table for ${tool.id}`)

  const params: Record<string, DocumentedParam> = {}
  const rowPattern = /^\| `([^`]+)` \| ([^|]+?) \| (Yes|No) \| (.*) \|$/gm
  for (const match of input.matchAll(rowPattern)) {
    params[match[1]] = {
      type: match[2].trim(),
      required: match[3] as DocumentedParam['required'],
      description: match[4],
    }
  }
  return params
}

describe('generated Snowflake documentation', () => {
  it('documents every visible parameter in its corresponding action table', () => {
    const tools = registeredSnowflakeTools()

    for (const tool of tools) {
      expect(documentedParams(tool), tool.id).toEqual(expectedParams(tool))
    }
  })
})
