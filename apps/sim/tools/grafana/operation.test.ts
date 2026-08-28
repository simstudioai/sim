/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { checkDataSourceHealthTool } from '@/tools/grafana/check_data_source_health'
import { updateAlertRuleTool } from '@/tools/grafana/update_alert_rule'
import { updateDashboardTool } from '@/tools/grafana/update_dashboard'
import { updateFolderTool } from '@/tools/grafana/update_folder'

describe('Grafana operation declarations', () => {
  it.each([checkDataSourceHealthTool, updateAlertRuleTool, updateDashboardTool, updateFolderTool])(
    '$id has typed operation input and no HTTP metadata',
    (tool) => {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  )
})
