/**
 * The URLs a deploy makes live: after a source write deploys a workflow, each webhook it serves is
 * named with its URL, so nobody has to look it up with `sim workflows deployment status` after.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { parseWorkflowLock } from '@sim/workflow-code'
import { printError } from '#sim-cli/output/io'
import { sanitize } from '#sim-cli/output/render'
import type { GetWorkflowDeploymentResponse } from '../../generated/v2-api'
import { isRequestCancelled } from '../../http/client'
import type { OperationClient } from '../../runtime/called-operations'

/** A webhook of a deployed workflow, which callers reach at `url`. */
export interface DeployedUrl {
  /** The block key, with its const name when the lock names one: `leadin (hook)`. */
  block: string
  url: string
}

/** How source names a block: its key, with its const when that differs (`leadin (hook)`). */
export function blockLabel(key: string, ident: string): string {
  return ident === key ? key : `${key} (${ident})`
}

/**
 * Each block id of a lock (`.sim/lock.json`, parsed or as JSON text) mapped to its
 * {@link blockLabel}; empty when the lock does not parse.
 */
export function lockBlockNames(lockInput: unknown): Map<string, string> {
  const { lock } = parseWorkflowLock(lockInput)
  return new Map(
    Object.entries(lock?.blocks ?? {}).map(([key, entry]) => [
      entry.id,
      blockLabel(key, entry.ident),
    ])
  )
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
 * read is reported and yields none: the deploy itself stands. A cancelled read is rethrown, so a
 * cancelled command never reports success.
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
    if (isRequestCancelled(error)) throw error
    printError(
      `The deploy succeeded, but its webhook URLs could not be read (${sanitize(getErrorMessage(error))}): \`sim workflows deployment status ${sanitize(workflowId)}\` lists them.`
    )
    return []
  }
}

/** The URLs as one display line: `leadin (hook) https://…, …`. */
export function deployedUrlsText(urls: readonly DeployedUrl[]): string {
  return urls.map(({ block, url }) => `${sanitize(block)} ${sanitize(url)}`).join(', ')
}
