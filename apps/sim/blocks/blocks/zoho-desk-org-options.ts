import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { requestJson } from '@/lib/api/client/request'
import { zohoDeskListOrganizationsContract } from '@/lib/api/contracts/tools/zoho-desk'
import { fetchOAuthToken } from '@/hooks/selectors/helpers'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('ZohoDeskOrgOptions')

/**
 * Populate a Zoho Desk organization selector from the connected credential.
 *
 * Shared by the Zoho Desk block (tool operations, credential in `credential`/
 * `manualCredential`) and its trigger (credential in `triggerCredentials`). It
 * lives in its own module so the trigger can reuse it without importing the
 * block file, which would create a block <-> trigger import cycle.
 */
export async function fetchZohoDeskOrganizationOptions(
  blockId: string
): Promise<Array<{ label: string; id: string }>> {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) return []
  const blockValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]
  const credentialId =
    (blockValues?.credential as string) ||
    (blockValues?.manualCredential as string) ||
    (blockValues?.triggerCredentials as string)
  if (!credentialId) return []
  // Degrade to an empty list on any failure (expired token, wrong data center,
  // network error): the org field is a free-text combobox, so the user can still
  // type an organization ID manually instead of the selector hard-failing.
  try {
    const bundle = await fetchOAuthToken(credentialId, activeWorkflowId)
    if (!bundle) return []
    const data = await requestJson(zohoDeskListOrganizationsContract, {
      body: { accessToken: bundle.accessToken, apiDomain: bundle.apiDomain ?? null },
    })
    return data.organizations.map((org) => ({
      label: org.companyName ? `${org.companyName} (${org.id})` : org.id,
      id: org.id,
    }))
  } catch (error) {
    logger.warn('Failed to load Zoho Desk organizations', { message: getErrorMessage(error) })
    return []
  }
}
