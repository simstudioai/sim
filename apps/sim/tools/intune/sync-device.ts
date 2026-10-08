import type { IntuneSyncDeviceParams, IntuneSyncDeviceResponse } from '@/tools/intune/types'
import {
  buildIntuneActionUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  readIntuneActionResponse,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneSyncDeviceTool: ToolConfig<IntuneSyncDeviceParams, IntuneSyncDeviceResponse> = {
  id: 'intune_sync_device',
  name: 'Microsoft Intune Sync Device',
  description: 'Request a device check-in to receive pending Intune policies and actions',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    managedDeviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Intune managed device ID (not the Microsoft Entra device ID)',
    },
  },
  request: {
    url: (params) => buildIntuneActionUrl(params.managedDeviceId, 'syncDevice'),
    method: 'POST',
    headers: intuneHeaders,
    retry: { enabled: false },
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => ({
    success: true,
    output: await readIntuneActionResponse(response, context),
  }),
  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Microsoft Intune accepted the request; device completion is asynchronous',
    },
  },
}
