import type { IntuneGetDetectedAppParams, IntuneGetDetectedAppResponse } from '@/tools/intune/types'
import { INTUNE_DETECTED_APP_PROPERTIES } from '@/tools/intune/types'
import {
  buildIntuneResourcePath,
  buildIntuneResourceUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  mapIntuneDetectedApp,
  readIntuneEntity,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneGetDetectedAppTool: ToolConfig<
  IntuneGetDetectedAppParams,
  IntuneGetDetectedAppResponse
> = {
  id: 'intune_get_detected_app',
  name: 'Microsoft Intune Get Detected App',
  description: 'Read detected app details from Microsoft Intune',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    detectedAppId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Detected application ID',
    },
  },
  request: {
    url: (params) =>
      buildIntuneResourceUrl(buildIntuneResourcePath('detectedApps', params.detectedAppId)),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    return {
      success: true,
      output: { app: await readIntuneEntity(response, mapIntuneDetectedApp, context) },
    }
  },
  outputs: {
    app: {
      type: 'json',
      description: 'Get Detected App',
      properties: INTUNE_DETECTED_APP_PROPERTIES,
    },
  },
}
