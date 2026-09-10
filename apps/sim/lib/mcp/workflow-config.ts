import { filterUndefined, isPlainRecord, omit } from '@sim/utils/object'
import { isMcpRuntimeReference } from '@/lib/mcp/operation-policy'
import {
  type CanonicalGroup,
  type CanonicalModeOverrides,
  resolveActiveCanonicalValue,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'

export const MCP_FIELD_GROUPS = {
  server: { canonicalId: 'server', basicId: 'serverSelector', advancedIds: ['serverReference'] },
  tool: { canonicalId: 'tool', basicId: 'toolSelector', advancedIds: ['toolReference'] },
} satisfies Record<string, CanonicalGroup>

/** Normalizes saved MCP selections before editing, serialization, or trusted execution checks. */
export function normalizeMcpBlockValues(
  saved: Record<string, unknown>,
  savedModes: CanonicalModeOverrides = {}
) {
  const values = omit(saved, ['server', 'connection', 'tool', 'operationPolicy'])
  const canonicalModes = filterUndefined(savedModes) as Record<string, 'basic' | 'advanced'>
  for (const id of ['server', 'tool']) {
    const mode = canonicalModes[id]
    if (mode !== undefined && mode !== 'basic' && mode !== 'advanced')
      throw new Error(`Invalid MCP ${id} field mode`)
  }
  if (!Object.hasOwn(saved, 'serverSelector') && !Object.hasOwn(saved, 'serverReference')) {
    const server =
      saved.connection != null && saved.connection !== '' ? saved.connection : saved.server
    const advanced = isMcpRuntimeReference(server)
    values[advanced ? 'serverReference' : 'serverSelector'] = server
    canonicalModes.server = advanced ? 'advanced' : 'basic'
  }
  if (!Object.hasOwn(saved, 'toolSelector') && !Object.hasOwn(saved, 'toolReference')) {
    const tool =
      !saved.operation &&
      !saved.operationPolicy &&
      typeof saved.server === 'string' &&
      typeof saved.tool === 'string' &&
      saved.tool.startsWith(`${saved.server}-`)
        ? saved.tool.slice(saved.server.length + 1)
        : saved.tool
    const advanced = isMcpRuntimeReference(tool)
    values[advanced ? 'toolReference' : 'toolSelector'] = tool
    canonicalModes.tool = advanced ? 'advanced' : 'basic'
  }
  values.operation = saved.operation ?? 'run'
  const server = resolveActiveCanonicalValue(MCP_FIELD_GROUPS.server, values, canonicalModes)
  if (
    isMcpRuntimeReference(server) &&
    resolveCanonicalMode(MCP_FIELD_GROUPS.tool, values, canonicalModes) === 'basic'
  ) {
    values.toolReference = values.toolSelector
    canonicalModes.tool = 'advanced'
  }
  return { values, canonicalModes }
}

/** Reads only the active members; dormant values never become execution targets. */
export function resolveMcpBlockConfig(
  saved: Record<string, unknown>,
  savedModes?: CanonicalModeOverrides
) {
  const { values, canonicalModes } = normalizeMcpBlockValues(saved, savedModes)
  return {
    server: resolveActiveCanonicalValue(MCP_FIELD_GROUPS.server, values, canonicalModes),
    tool: resolveActiveCanonicalValue(MCP_FIELD_GROUPS.tool, values, canonicalModes),
    action: values.operation,
    argumentsMode:
      resolveCanonicalMode(MCP_FIELD_GROUPS.tool, values, canonicalModes) === 'advanced'
        ? ('json' as const)
        : ('generated' as const),
  }
}

/** Moves interim split connection bindings into the single executable target input. */
export function normalizeMcpToolAttachments(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((tool) => {
    if (!isPlainRecord(tool)) return tool
    if (tool.type === 'mcp') return omit(tool, ['operationPolicy'])
    if (tool.type !== 'mcp-server-advanced' || !isPlainRecord(tool.params)) return tool
    const { connectionId } = tool.params
    if (connectionId == null || connectionId === '')
      return { ...tool, params: omit(tool.params, ['connectionId']) }
    if (typeof connectionId !== 'string') throw new Error('Invalid saved MCP connection')
    return { ...tool, params: { ...omit(tool.params, ['connectionId']), serverId: connectionId } }
  })
}
