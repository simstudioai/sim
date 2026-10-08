import type { IntuneRetireDeviceParams, IntuneRetireDeviceResponse } from '@/tools/intune/types'
import {
  buildIntuneActionUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  readIntuneActionResponse,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneRetireDeviceTool: ToolConfig<
  IntuneRetireDeviceParams,
  IntuneRetireDeviceResponse
> = {
  id: 'intune_retire_device',
  name: 'Microsoft Intune Retire Device',
  description: 'Retire a device after explicit confirmation, removing company data and management',
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
    url: (params) => buildIntuneActionUrl(params.managedDeviceId, 'retire', params.confirmAction),
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
