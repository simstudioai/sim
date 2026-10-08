import type { IntuneRebootDeviceParams, IntuneRebootDeviceResponse } from '@/tools/intune/types'
import {
  buildIntuneActionUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  readIntuneActionResponse,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneRebootDeviceTool: ToolConfig<
  IntuneRebootDeviceParams,
  IntuneRebootDeviceResponse
> = {
  id: 'intune_reboot_device',
  name: 'Microsoft Intune Reboot Device',
  description:
    'Request a device restart after explicit confirmation; may interrupt the signed-in user',
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
    confirmAction: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit user confirmation to perform this disruptive device action',
    },
  },
  request: {
    url: (params) =>
      buildIntuneActionUrl(params.managedDeviceId, 'rebootNow', params.confirmAction),
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
