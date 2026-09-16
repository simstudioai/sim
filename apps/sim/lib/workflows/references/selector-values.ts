import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSelectorOption } from '@/lib/selectors/application/get-selector-option'
import {
  getSelectorManifestEntry,
  isSelectorReady,
  type SelectorKey,
  type ServerSelectorKey,
} from '@/lib/selectors/manifest'
import type { SafeSelectorOption, SelectorContext } from '@/lib/selectors/types'

/** Matches the editor's comma-separated selector representation without splitting scalar IDs. */
export function selectedReferenceValues(value: string, multiple = false): string[] {
  return [
    ...new Set((multiple ? value.split(',') : [value]).map((item) => item.trim()).filter(Boolean)),
  ]
}

/** Request-local, bounded option verification shared by import and workspace sync. */
export function workflowSelectorValidator(principal: Principal, workspaceId: string) {
  const requests = new Map<string, Promise<SafeSelectorOption | null>>()
  return async (field: {
    selectorKey: string
    context: SelectorContext
    value: string
    title: string
    multiSelect?: boolean
  }) => {
    const key = field.selectorKey as SelectorKey
    const manifest = getSelectorManifestEntry(key)
    if (manifest.classification === 'local') return true
    if (!isSelectorReady(key, field.context))
      throw new OrchestrationError(
        'validation',
        `Configure the destination dependencies of ${field.title} first`
      )
    let values = selectedReferenceValues(field.value, field.multiSelect)
    if (key === 'mcp.tools' && field.context.mcpServerId) {
      const serverId = field.context.mcpServerId
      values = values.map((value) => {
        for (const prefix of [`mcp-${serverId}-`, `${serverId}-`])
          if (value.startsWith(prefix)) return value.slice(prefix.length)
        return value
      })
    }
    for (const id of values) {
      const cacheKey = JSON.stringify([key, field.context, id])
      if (!requests.has(cacheKey)) {
        if (requests.size >= 100)
          throw new OrchestrationError(
            'payload_too_large',
            'Operation exceeds 100 distinct selector validations'
          )
        requests.set(
          cacheKey,
          getSelectorOption.execute({
            principal,
            input: {
              selectorKey: key as ServerSelectorKey,
              scope: { kind: 'workspace', workspaceId },
              context: field.context,
              id,
            },
          })
        )
      }
      if ((await requests.get(cacheKey))?.id !== id) return false
    }
    return true
  }
}
