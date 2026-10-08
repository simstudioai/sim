import type {
  IntuneRemoteLockDeviceParams,
  IntuneRemoteLockDeviceResponse,
} from '@/tools/intune/types'
import {
  buildIntuneActionUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  readIntuneActionResponse,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneRemoteLockDeviceTool: ToolConfig<
  IntuneRemoteLockDeviceParams,
  IntuneRemoteLockDeviceResponse
> = {
  id: 'intune_remote_lock_device',
  name: 'Microsoft Intune Remote Lock Device',
  description: 'Request a remote device lock after explicit confirmation on supported platforms',
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
      buildIntuneActionUrl(params.managedDeviceId, 'remoteLock', params.confirmAction),
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
