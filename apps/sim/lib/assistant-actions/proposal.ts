import { createHash } from 'node:crypto'
import type { copilotAsyncToolCalls } from '@sim/db/schema'
import { sortObjectKeysDeep, toRecord } from '@sim/utils/object'
import { resolveAssistantActionBinding } from '@/lib/assistant-actions/binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isAssistantIntegrationParameter } from '@/lib/mothership/assistant/tool-policy'
import { getToolMetadata } from '@/tools/metadata'

type ActionRecord = typeof copilotAsyncToolCalls.$inferSelect

/** The review version covers the immutable invocation, independent of object key order or later decisions. */
export function assistantProposalVersion(record: ActionRecord): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        sortObjectKeysDeep({
          runId: record.runId,
          toolCallId: record.toolCallId,
          toolId: record.executableName,
          targetWorkspaceId: record.targetWorkspaceId,
          binding: record.assistantAction,
          args: record.args,
        })
      )
    )
    .digest('hex')
}

/** Editable text fields are explicitly declared; authentication and destinations cannot be patched. */
export function applyAssistantReviewEdits(
  record: ActionRecord,
  edits: Record<string, string> = {}
): Record<string, unknown> {
  const tool = getToolMetadata(record.executableName ?? '')
  if (!tool?.assistant)
    throw new OrchestrationError(
      'conflict',
      'This operation changed. Ask Assistant to propose it again.'
    )
  const args = { ...toRecord(record.args) }
  for (const [name, value] of Object.entries(edits)) {
    const field = tool.assistant.reviewFields?.find((entry) => entry.name === name)
    const param = tool.params[name]
    if (
      !field?.editable ||
      field.target ||
      param?.type !== 'string' ||
      !isAssistantIntegrationParameter(tool, name)
    )
      throw new OrchestrationError('validation', `${name} is not editable in this review.`)
    if (typeof value !== 'string' || (param.required && !value.trim()))
      throw new OrchestrationError('validation', `${field.label} must contain text.`)
    args[name] = value
  }
  resolveAssistantActionBinding(tool.id, args)
  return args
}

/** Every supplied non-authentication argument remains visible, even without a custom review label. */
export function assistantReviewFields(record: ActionRecord) {
  const tool = getToolMetadata(record.executableName ?? '')
  const args = toRecord(record.args)
  const declared = tool?.assistant?.reviewFields ?? []
  const names = [...new Set([...declared.map((field) => field.name), ...Object.keys(args)])]
  return names
    .filter(
      (name) =>
        !['credential', 'credentialId', 'oauthCredential'].includes(name) &&
        tool &&
        isAssistantIntegrationParameter(tool, name)
    )
    .map((name) => {
      const field = declared.find((entry) => entry.name === name)
      const supplied = args[name]
      const value =
        field?.target &&
        (supplied === undefined || (typeof supplied === 'string' && !supplied.trim()))
          ? tool?.params[name]?.default
          : supplied
      return {
        name,
        label: field?.label ?? name,
        target: field?.target === true,
        editable:
          field?.editable === true &&
          field.target !== true &&
          tool?.params[name]?.type === 'string',
        format:
          field?.format ??
          (typeof value === 'string' ||
          (value === undefined && tool?.params[name]?.type === 'string')
            ? ('text' as const)
            : ('json' as const)),
        value: value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value),
      }
    })
}
