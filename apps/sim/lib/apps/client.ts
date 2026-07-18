export async function publishAppWithDeploy(params: {
  projectId: string
  expectedVersion?: number
}): Promise<{
  releaseId: string
  revisionId: string
  buildId: string
  deployments: Array<{ workflowId: string; deploymentVersionId: string }>
}> {
  const response = await fetch(
    `/api/apps/${encodeURIComponent(params.projectId)}/releases/publish-with-deploy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(typeof params.expectedVersion === 'number'
          ? { expectedVersion: params.expectedVersion }
          : {}),
      }),
    }
  )
  const json = (await response.json().catch(() => ({}))) as {
    error?: string
    releaseId?: string
    revisionId?: string
    buildId?: string
    deployments?: Array<{ workflowId: string; deploymentVersionId: string }>
  }
  if (!response.ok) {
    throw new Error(json.error || `Publish with deploy failed (${response.status})`)
  }
  if (!json.releaseId || !json.revisionId || !json.buildId || !json.deployments) {
    throw new Error('Invalid publish-with-deploy response')
  }
  return {
    releaseId: json.releaseId,
    revisionId: json.revisionId,
    buildId: json.buildId,
    deployments: json.deployments,
  }
}
