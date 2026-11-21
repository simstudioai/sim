/**
 * The URLs a deploy makes live: after a source write deploys a workflow, each webhook it serves is
 * named with its URL, so nobody has to look it up with `sim workflows deployment status` after.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { printError } from '#sim-cli/output/io'
import type { GetWorkflowDeploymentResponse } from '../../generated/v2-api'
import type { OperationClient } from '../../runtime/called-operations'

/** A webhook of a deployed workflow, which callers reach at `url`. */
export interface DeployedUrl {
  /** The block key, with its const name when the lock names one: `leadin (hook)`. */
  block: string
  url: string
}

/** Each block id of a lock (`.sim/lock.json`) mapped to how source names it: `key (ident)`. */
export function lockBlockNames(lock: unknown): Map<string, string> {
  const names = new Map<string, string>()
  const blocks = isRecordLike(lock) ? lock.blocks : undefined
  if (!isRecordLike(blocks)) return names
  for (const [key, entry] of Object.entries(blocks)) {
    if (!isRecordLike(entry) || typeof entry.id !== 'string') continue
    const ident = typeof entry.ident === 'string' && entry.ident !== key ? ` (${entry.ident})` : ''
    names.set(entry.id, `${key}${ident}`)
  }
  return names
}

/** The deployment's webhook URLs, each named through `names` (block id → source name). */
export function namedUrls(
  webhooks: GetWorkflowDeploymentResponse['data']['webhooks'],
  names: ReadonlyMap<string, string>
): DeployedUrl[] {
  return webhooks.map(({ blockId, url }) => ({
    block: (blockId !== null ? names.get(blockId) : undefined) ?? blockId ?? 'webhook',
    url,
  }))
}

/**
 * The URL of each webhook `workflowId`'s live deployment serves, named through `names`. A failed
 * read is reported and yields none: the deploy itself stands.
 */
export async function deployedUrls(
  client: OperationClient<'getWorkflowDeployment'>,
  workflowId: string,
  names: ReadonlyMap<string, string>
): Promise<DeployedUrl[]> {
  try {
    const { data } = await client.request<GetWorkflowDeploymentResponse>('getWorkflowDeployment', {
      params: { workflowId },
    })
    return namedUrls(data.webhooks, names)
  } catch (error) {
    printError(
      `The deploy succeeded, but its webhook URLs could not be read (${getErrorMessage(error)}): \`sim workflows deployment status ${workflowId}\` lists them.`
    )
    return []
  }
}

/** The URLs as one display line: `leadin (hook) https://…, …`. */
export function deployedUrlsText(urls: readonly DeployedUrl[]): string {
  return urls.map(({ block, url }) => `${block} ${url}`).join(', ')
}
