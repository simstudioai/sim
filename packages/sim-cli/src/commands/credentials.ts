import type { Command } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import { type CreateCredentialConnectionResponse, V2_OPERATIONS } from '../generated/v2-api'
import { renderResult } from '../runtime/result'

const CONNECTION_RESULT: CommandSpec = {
  fields: [
    { header: 'connection link', path: 'authorizationUrl' },
    { header: 'expires', path: 'expiresAt', format: 'timestamp' },
  ],
}

type ConnectionBody = { providerId: string; displayName: string } | { credentialId: string }

async function createConnectionLink(command: Command, body: ConnectionBody): Promise<void> {
  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.createCredentialConnection
  const response = await client.request<CreateCredentialConnectionResponse>(operation.path, {
    method: operation.method,
    body: {
      workspaceId: client.requireWorkspace(),
      ...body,
    },
  })

  renderResult('createCredentialConnection', profile.output, response.data, CONNECTION_RESULT)
}

/** Adds the human-facing OAuth connection commands backed by the v2 credentials API. */
export function attachCredentialCommands(program: Command): void {
  const credentials = program.commands.find((command) => command.name() === 'credentials')
  if (!credentials) throw new Error('The generated credentials command group is missing')

  credentials
    .command('connect <providerId>')
    .description('Create a short-lived link for connecting an OAuth provider')
    .requiredOption('--name <displayName>', 'Name shown for the new credential in Sim')
    .action(async (providerId: string, options: { name: string }, command: Command) =>
      createConnectionLink(command, { providerId, displayName: options.name })
    )

  credentials
    .command('reconnect <credentialId>')
    .description('Create a short-lived link for reconnecting an OAuth credential')
    .action((credentialId: string, _options: unknown, command: Command) =>
      createConnectionLink(command, { credentialId })
    )
}
