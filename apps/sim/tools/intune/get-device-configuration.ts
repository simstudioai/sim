import type {
  IntuneGetDeviceConfigurationParams,
  IntuneGetDeviceConfigurationResponse,
} from '@/tools/intune/types'
import { INTUNE_POLICY_PROPERTIES } from '@/tools/intune/types'
import {
  buildIntuneResourcePath,
  buildIntuneResourceUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  mapIntunePolicy,
  readIntuneEntity,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneGetDeviceConfigurationTool: ToolConfig<
  IntuneGetDeviceConfigurationParams,
  IntuneGetDeviceConfigurationResponse
> = {
  id: 'intune_get_device_configuration',
  name: 'Microsoft Intune Get Device Configuration',
  description: 'Read common metadata for an Intune device configuration',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    configurationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device configuration ID',
    },
  },
  request: {
    url: (params) =>
      buildIntuneResourceUrl(
        buildIntuneResourcePath('deviceConfigurations', params.configurationId)
      ),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    return {
      success: true,
      output: { configuration: await readIntuneEntity(response, mapIntunePolicy, context) },
    }
  },
  outputs: {
    configuration: {
      type: 'json',
      description: 'Get Device Configuration',
      properties: INTUNE_POLICY_PROPERTIES,
    },
  },
}
