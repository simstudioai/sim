import type {
  IntuneListDetectedAppsParams,
  IntuneListDetectedAppsResponse,
} from '@/tools/intune/types'
import { INTUNE_DETECTED_APP_PROPERTIES, INTUNE_NEXT_LINK_OUTPUT } from '@/tools/intune/types'
import {
  buildIntuneCollectionUrl,
  INTUNE_AUTH_PARAMS,
  INTUNE_PAGE_PARAMS,
  intuneHeaders,
  mapIntuneDetectedApp,
  readIntunePage,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneListDetectedAppsTool: ToolConfig<
  IntuneListDetectedAppsParams,
  IntuneListDetectedAppsResponse
> = {
  id: 'intune_list_detected_apps',
  name: 'Microsoft Intune List Detected Apps',
  description: 'Read one page of detected apps from Microsoft Intune',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    ...INTUNE_PAGE_PARAMS,
  },
  request: {
    url: (params) => buildIntuneCollectionUrl('detectedApps', params),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    const page = await readIntunePage(response, 'detectedApps', mapIntuneDetectedApp, context)
    return { success: true, output: { apps: page.items, nextLink: page.nextLink } }
  },
  outputs: {
    apps: {
      type: 'array',
      description: 'List Detected Apps',
      items: { type: 'object', properties: INTUNE_DETECTED_APP_PROPERTIES },
    },
    nextLink: INTUNE_NEXT_LINK_OUTPUT,
  },
}
