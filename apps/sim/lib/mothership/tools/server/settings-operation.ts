import type { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'

export interface SettingsOperation {
  effect: 'read' | 'write'
  inputSchema: z.ZodType
  execute(context: SettingsContext, input: Record<string, unknown>): Promise<unknown>
}

export function settingsOperation<S extends z.ZodType>(
  effect: SettingsOperation['effect'],
  schema: S,
  execute: (context: SettingsContext, input: z.output<S>) => Promise<unknown>
): SettingsOperation {
  return {
    effect,
    inputSchema: schema,
    execute: (context, input) => execute(context, parseSettingsArguments(schema, input)),
  }
}

export function parseSettingsArguments<S extends z.ZodType>(
  schema: S,
  input: unknown
): z.output<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    throw new OrchestrationError(
      'validation',
      parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ')
    )
  return parsed.data
}

export function settingsOrganizationId(context: SettingsContext): string {
  if (!context.organizationId) throw new OrchestrationError('not_found', 'Organization not found')
  return context.organizationId
}

export function settingsWorkspaceId(context: SettingsContext): string {
  if (!context.workspaceId) throw new OrchestrationError('not_found', 'Workspace not found')
  return context.workspaceId
}
