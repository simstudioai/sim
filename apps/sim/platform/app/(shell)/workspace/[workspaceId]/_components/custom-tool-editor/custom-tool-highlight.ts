import { escapeRegExp } from '@sim/utils/string'
import {
  escapeHtml,
  highlightSyntax,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/highlight'
import { createEnvVarPattern } from '@/platform/lib/data/workflow-editor'
import {
  createWorkflowVariablePattern,
  type SchemaParameter,
} from '@/platform/lib/data/workflow-editor/tool-input'

/**
 * A custom tool's function body: JavaScript markup with `{{SECRET}}` names, `<variable.name>`
 * references and the schema's parameter names marked in the reference color.
 */
export function highlightCustomToolCode(
  code: string,
  schemaParameters: readonly SchemaParameter[]
): string {
  const placeholders: Array<{ placeholder: string; original: string }> = []
  const hold = (prefix: string) => (match: string) => {
    const placeholder = `__${prefix}_${placeholders.length}__`
    placeholders.push({ placeholder, original: match })
    return placeholder
  }

  let processed = code.replace(createEnvVarPattern(), hold('ENV_VAR'))
  processed = processed.replace(createWorkflowVariablePattern(), hold('VARIABLE'))
  for (const param of schemaParameters) {
    processed = processed.replace(
      new RegExp(`\\b(${escapeRegExp(param.name)})\\b`, 'g'),
      hold('PARAM')
    )
  }

  let html = highlightSyntax(processed, 'javascript')
  for (const { placeholder, original } of placeholders) {
    html = html.replace(
      placeholder,
      () => `<span data-code-reference="">${escapeHtml(original)}</span>`
    )
  }
  return html
}
