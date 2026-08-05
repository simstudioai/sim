import { describe, expect, it } from 'vitest'
import {
  CONNECT_MODE,
  resolveAvailableConnectMode,
} from '@/app/workspace/[workspaceId]/integrations/connect-route'

describe('resolveAvailableConnectMode', () => {
  it('keeps a service-account deep link pending until its modal is available', () => {
    expect(
      resolveAvailableConnectMode(CONNECT_MODE.serviceAccount, {
        oauth: false,
        serviceAccount: false,
      })
    ).toBeNull()

    expect(
      resolveAvailableConnectMode(CONNECT_MODE.serviceAccount, {
        oauth: false,
        serviceAccount: true,
      })
    ).toBe(CONNECT_MODE.serviceAccount)
  })

  it('only resolves OAuth when OAuth is available', () => {
    expect(
      resolveAvailableConnectMode(CONNECT_MODE.oauth, {
        oauth: false,
        serviceAccount: true,
      })
    ).toBeNull()

    expect(
      resolveAvailableConnectMode(CONNECT_MODE.oauth, {
        oauth: true,
        serviceAccount: false,
      })
    ).toBe(CONNECT_MODE.oauth)
  })
})
