/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { uptimeRobotCreatePspTool } from '@/tools/uptimerobot/create_psp'
import { uptimeRobotUpdatePspTool } from '@/tools/uptimerobot/update_psp'

describe('UptimeRobot PSP operation declarations', () => {
  it('materializes create input without HTTP metadata', () => {
    expect(uptimeRobotCreatePspTool.request).toBeUndefined()
    expect(
      uptimeRobotCreatePspTool.operation.input({
        apiKey: '{{UPTIMEROBOT_API_KEY}}',
        friendlyName: '<Status.name>',
      })
    ).toMatchObject({
      apiKey: '{{UPTIMEROBOT_API_KEY}}',
      friendlyName: '<Status.name>',
    })
  })

  it('materializes update input without HTTP metadata', () => {
    expect(uptimeRobotUpdatePspTool.request).toBeUndefined()
    expect(
      uptimeRobotUpdatePspTool.operation.input({
        apiKey: '{{UPTIMEROBOT_API_KEY}}',
        pspId: 1,
        friendlyName: '<Status.name>',
      })
    ).toMatchObject({
      apiKey: '{{UPTIMEROBOT_API_KEY}}',
      pspId: 1,
      friendlyName: '<Status.name>',
    })
  })
})
