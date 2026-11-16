import { describe, expect, it } from 'vitest'
import { GrafanaBlock } from '@/blocks/blocks/grafana'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = GrafanaBlock.tools.config?.params
  if (!mapper) throw new Error('Grafana block has no params mapper')
  return mapper(params, context)
}

describe('Grafana tool calls', () => {
  it('keeps the model folder UID and parent UID when moving a folder', () => {
    const mapped = mapParams(
      { folderUid: 'child', parentUid: 'parent' },
      { operation: 'grafana_move_folder' }
    )

    expect(mapped).toMatchObject({ folderUid: 'child', parentUid: 'parent' })
  })

  it('keeps the model folder UID and rule group when reading an alert rule group', () => {
    const mapped = mapParams(
      { folderUid: 'folder-1', ruleGroup: 'cpu' },
      { operation: 'grafana_get_alert_rule_group' }
    )

    expect(mapped).toMatchObject({ folderUid: 'folder-1', ruleGroup: 'cpu' })
  })
})
