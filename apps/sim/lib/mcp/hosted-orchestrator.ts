import { env, getEnv } from '@/lib/env'
import type { McpServerProject, McpServerVersion } from '@/lib/mcp/types'

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getHostedBaseUrl(): string {
  const base =
    env.HOSTED_MCP_BASE_URL || getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
  return base.replace(/\/$/, '')
}

export interface HostedBuildResult {
  artifactUrl: string
  runtimeMetadata: Record<string, any>
  logsUrl: string
}

export interface HostedActivationResult {
  endpointUrl: string
  logsUrl: string
}

export async function buildHostedBundle(
  project: Pick<McpServerProject, 'id' | 'name' | 'runtime' | 'entryPoint' | 'template'>,
  version: Pick<McpServerVersion, 'versionNumber'>
): Promise<HostedBuildResult> {
  // Simulate build time to give deploy logs meaningful timestamps
  await delay(1500)

  const artifactUrl = `https://cdn.sim.ai/mcp/${project.id}/v${version.versionNumber}.tar.gz`
  return {
    artifactUrl,
    runtimeMetadata: {
      runtime: project.runtime,
      entryPoint: project.entryPoint,
      template: project.template,
      version: version.versionNumber,
      builtAt: new Date().toISOString(),
    },
    logsUrl: `https://logs.sim.ai/mcp/${project.id}/v${version.versionNumber}.txt`,
  }
}

export async function activateHostedDeployment(deploymentId: string): Promise<HostedActivationResult> {
  await delay(800)

  const baseUrl = getHostedBaseUrl()
  return {
    endpointUrl: `${baseUrl}/hosted/mcp/${deploymentId}`,
    logsUrl: `${baseUrl}/hosted/mcp/${deploymentId}/logs`,
  }
}
