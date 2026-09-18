import { z } from 'zod'
import type { MothershipBlockDetail } from '@/lib/api/contracts/mothership-catalog'
import { getToolBindingAuthoringSchema } from '@/lib/workflows/tool-input/authoring'

/** Publish only the selected block's attachment contract, not the integration tool catalog. */
export function withToolBindingHints(detail: MothershipBlockDetail): MothershipBlockDetail {
  const schema = getToolBindingAuthoringSchema(detail.id)
  if (!schema) return detail
  const { $schema: _version, ...valueSchema } = z.toJSONSchema(schema)
  const isMothership = detail.id === 'mothership'
  return {
    ...detail,
    inputSchema: detail.inputSchema.map((field) =>
      field.type !== 'tool-input'
        ? field
        : {
            ...field,
            valueSchema,
            toolBinding: {
              selectionMode: isMothership ? 'additive' : 'explicit',
              discovery: [
                'workflows tools <workflowId> --block <blockId>',
                ...(!isMothership
                  ? [
                      'blocks get <type> --operation <operation>',
                      'custom-tools list',
                      'custom-tools get <id>',
                    ]
                  : []),
                'mcp-servers list',
                'mcp-servers tools list <serverId>',
              ],
              naming: isMothership
                ? 'Use the exact MCP toolName returned by discovery. Sim Chat discovers the callable toolId and invokes it through call_integration_tool. An attachment title/name cannot rename the operation.'
                : 'Integration operations use operations[operation].toolId from blocks get (not the UI toolName/title). Custom tools use custom_ followed by the saved definition title or inline title. MCP tools use a server-qualified ID derived from the discovered toolName. Duplicate bindings receive provider-generated suffixes. Do not override title, name, toolId or functionName when attaching a saved tool. Inline custom definitions require title = schema.function.name.',
              access: isMothership
                ? 'Selections add MCP operations to available integration access; this is not an integration allowlist. Empty tools does not disable integrations. Fixed MCP arguments, force mode and variable permission mode are not supported by this block. Actual calls remain subject to execution permissions and MCP policies.'
                : 'This array defines the selected tools, subject to execution permissions. For integration, inline custom and individual MCP bindings, params fixes author-supplied values; remaining eligible parameters are model-supplied. Saved custom-tool references do not retain fixed arguments. auto lets the model choose, force requires a call, none disables the binding. Runtime helpers such as skill loading are separate. Labels do not enforce approvals or permissions.',
            },
          }
    ),
  }
}
