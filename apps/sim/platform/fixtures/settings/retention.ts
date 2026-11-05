import { toRecord } from '@sim/utils/object'
import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { DataRetentionResponse } from '@/platform/lib/data/data-retention'

type Values = DataRetentionResponse['configured']

const defaults: Values = {
  logRetentionHours: null,
  softDeleteRetentionHours: null,
  taskCleanupHours: null,
  fileVersionRetentionHours: null,
  piiRedaction: null,
  retentionOverrides: null,
}

const populated: Values = {
  ...defaults,
  logRetentionHours: 720,
  softDeleteRetentionHours: 2160,
  taskCleanupHours: 168,
  piiRedaction: {
    rules: [
      {
        id: 'organization-sensitive-data',
        workspaceId: null,
        stages: {
          input: { enabled: true, entityTypes: ['EMAIL_ADDRESS'], language: 'en' },
          blockOutputs: { enabled: false, entityTypes: [], language: 'en' },
          logs: { enabled: true, entityTypes: ['CREDIT_CARD', 'PHONE_NUMBER'], language: 'en' },
        },
      },
    ],
  },
  retentionOverrides: [{ workspaceId: settingsWorkspaces[0].id, logRetentionHours: 336 }],
}

export async function retentionFixture(request: Request, state: SettingsFixtureState) {
  const key = 'data-retention'
  const initial = state.scenario === 'empty' ? defaults : populated
  const configured = { ...initial, ...toRecord(state.records.get(key)) }
  if (request.method === 'PUT') {
    Object.assign(configured, toRecord(await request.json()))
    state.records.set(key, configured)
  }
  return {
    success: true,
    data: { isEnterprise: true, defaults, configured, effective: configured },
  }
}
