import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import { backoffWithJitter } from '@sim/utils/retry'
import { type Command, Option } from 'commander'
import { printProtocolResult } from '#sim-cli/commands/protocol/result'
import type {
  CompleteSourcePermissionImportResponse,
  CreateSourcePermissionImportResponse,
  PutSourcePermissionImportPartResponse,
} from '#sim-cli/generated/v2-api'
import { SimApiError } from '#sim-cli/http/client'
import { apiCommand } from '#sim-cli/runtime/called-operations'
import { type PermissionCsvProvider, stagePermissionCsvs } from '#sim-cli/transfer/permission-csv'

/** Adds a bounded CSV upload workflow over the existing revisioned import operations. */
export function attachSourcePermissionCommands(program: Command): void {
  let parent = program
  for (const name of ['organizations', 'search', 'sources', 'permissions']) {
    const child = parent.commands.find((command) => command.name() === name)
    if (!child) throw new Error(`Missing generated command group: ${name}`)
    parent = child
  }
  const [command, connect] = apiCommand(parent, 'upload', [
    'createSourcePermissionImport',
    'putSourcePermissionImportPart',
    'completeSourcePermissionImport',
  ])
  command
    .argument('<sourceId>', 'Search source identifier')
    .description('Replace source permissions from two CSV files, uploaded in bounded parts')
    .allowExcessArguments(false)
    .requiredOption('--organization <id>', 'Organization identifier')
    .addOption(
      new Option('--provider <provider>', 'Permission provider')
        .choices(['gitlab'])
        .makeOptionMandatory()
    )
    .requiredOption('--expected-revision <number>', 'Revision read before exporting the CSVs')
    .requiredOption('--user-mapping <path>', 'Complete user mapping CSV')
    .requiredOption('--project-permissions <path>', 'Complete project permissions CSV')
    .option('-y, --yes', 'Confirm replacement of all source permissions (required)')
    .action(
      async (
        sourceId: string,
        options: {
          organization: string
          provider: PermissionCsvProvider
          expectedRevision: string
          userMapping: string
          projectPermissions: string
          yes?: boolean
        }
      ) => {
        if (!options.yes)
          throw new SimApiError(
            'This replaces all source permissions. Re-run with --yes to confirm.',
            0
          )
        const expectedRevision = Number(options.expectedRevision)
        if (
          !Number.isInteger(expectedRevision) ||
          expectedRevision <= 0 ||
          expectedRevision >= 2147483647
        )
          throw new SimApiError('--expected-revision must be an integer from 1 to 2147483646.', 0)
        const { client, profile } = connect()
        const signal = profile.signal
        const staged = await stagePermissionCsvs(options.provider, options, signal)
        const params = { organizationId: options.organization, sourceId }
        const retry = async <T>(request: () => Promise<T>): Promise<T> => {
          for (let attempt = 1; ; attempt++) {
            signal?.throwIfAborted()
            try {
              return await request()
            } catch (error) {
              if (
                !(error instanceof SimApiError) ||
                attempt >= 5 ||
                (error.code !== 'RESPONSE_READ_FAILED' &&
                  error.status !== 0 &&
                  error.status !== 429 &&
                  error.status < 500)
              )
                throw error
              await setTimeout(
                backoffWithJitter(attempt, error.retryAfterMs, { maxMs: 300_000 }),
                undefined,
                { signal }
              )
            }
          }
        }
        try {
          const started = await client.request<CreateSourcePermissionImportResponse>(
            'createSourcePermissionImport',
            {
              params,
              body: { provider: options.provider, expectedRevision, ...staged.manifest },
            }
          )
          const importParams = { ...params, importId: started.data.id }
          for (const [partNumber, part] of staged.parts.entries()) {
            const content = await readFile(part.path, 'utf8')
            const result = await retry(() =>
              client.request<PutSourcePermissionImportPartResponse>(
                'putSourcePermissionImportPart',
                {
                  params: { ...importParams, partNumber: String(partNumber) },
                  body: { field: part.field, content },
                }
              )
            )
            if (result.data.nextPart !== partNumber + 1)
              throw new SimApiError(
                'The server returned an unexpected upload position. Permissions were not activated.',
                0
              )
          }
          const result = await retry(() =>
            client.request<CompleteSourcePermissionImportResponse>(
              'completeSourcePermissionImport',
              { params: importParams, body: {} }
            )
          )
          printProtocolResult(profile.output, { sourceId, revision: result.data.revision })
        } finally {
          await staged.dispose()
        }
      }
    )
}
