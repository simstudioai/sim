import chalk from 'chalk'
import { type Command, Option } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import { type SetSecretResponse, V2_OPERATIONS } from '../generated/v2-api'
import { resolvePath, SimApiError } from '../http/client'
import { describeOperation } from '../runtime/build'
import { readArgumentSource } from '../runtime/request'
import { renderResult } from '../runtime/result'
import { promptSecret, SecretInputCancelledError } from '../terminal/secret-input'

const MAX_SECRET_LENGTH = 65_536
/** Conventional shell exit code for a command the user aborted at a prompt. */
const CANCELLED_EXIT_CODE = 130
const SECRET_SCOPES = ['workspace', 'personal'] as const

const SECRET_RESULT: CommandSpec = {
  fields: [
    { header: 'name' },
    { header: 'scope' },
    { header: 'role' },
    { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    { header: 'description' },
  ],
}

interface SetSecretOptions {
  scope: (typeof SECRET_SCOPES)[number]
  value?: string
  description?: string
  unredacted?: boolean
}

/**
 * Resolves a `--value` argument that names a file rather than carrying the
 * secret inline.
 *
 * `@path` and `@-` are the same curl convention the JSON flags already accept,
 * and a secret is the one value that most needs them: anything passed inline
 * lands in shell history and in `ps` for every other user on the box. The file
 * is used verbatim, trailing newline included, because a secret is bytes.
 * A value that genuinely starts with `@` is written `@@`, and only the leading
 * `@` is dropped.
 */
function readValueArgument(raw: string): string {
  if (raw.startsWith('@@')) return raw.slice(1)
  if (!raw.startsWith('@')) return raw
  return readArgumentSource(raw, 'value').text
}

function validateSecretValue(value: string): string {
  if (value.length === 0) throw new SimApiError('Secret value cannot be empty.', 0)
  if (value.length > MAX_SECRET_LENGTH) {
    throw new SimApiError(`Secret value cannot exceed ${MAX_SECRET_LENGTH} characters.`, 0)
  }
  return value
}

/**
 * A description and a redaction opt-out both belong to the workspace secret
 * teammates share; a personal secret has neither, and the API rejects both.
 * Failing here names the flag rather than surfacing a validation error against
 * the request body, and does so before the interactive value prompt. The
 * description's length bound is left to the API, whose message already names the
 * field — a copy here would silently drift from it.
 */
function validateWorkspaceOnlyFlag<T>(
  flag: string,
  value: T | undefined,
  scope: SetSecretOptions['scope']
): T | undefined {
  if (value === undefined) return undefined
  if (scope === 'personal') {
    throw new SimApiError(`--${flag} is only supported for a workspace secret.`, 0)
  }
  return value
}

/**
 * Reads the secret, from the flag or the prompt, or not at all.
 *
 * Nothing is read when the command carries a metadata flag and no `--value`:
 * that invocation is changing the description or the redaction setting of a
 * secret that already exists, and the API accepts a workspace body with no
 * value. Prompting there refused the invocation rather than losing anything:
 * off a TTY {@link promptSecret} throws `Interactive secret input requires a
 * terminal` before reading a byte, so `sim secrets set NAME --no-unredacted`
 * exited 1 in CI for a value it was never asked for, and on a TTY it stopped
 * to ask for one — a prompt that rejects an empty entry, so there was no way
 * to answer "leave the stored value alone". Skipping the read is what lets a
 * metadata-only edit run unattended and without a stored value to re-type.
 *
 * The knock-on, on a TTY: `sim secrets set NAME --description ...` used to
 * prompt for a value and now updates the description alone. A value still
 * travels by `--value`, or by the prompt when no metadata flag is passed.
 *
 * An abort at the prompt is reported here rather than thrown: Ctrl-C is the
 * user deciding not to run the command, and the shell's convention for that is
 * 130, which the top-level handler cannot tell apart from a real failure. The
 * exit is immediate for the same reason the handler's is — the prompt leaves
 * stdin listening, so a returning process would sit there instead of ending.
 */
async function readSecretValue(options: SetSecretOptions): Promise<string | undefined> {
  if (options.value !== undefined) return validateSecretValue(readValueArgument(options.value))
  if (options.description !== undefined || options.unredacted !== undefined) return undefined
  try {
    return validateSecretValue(await promptSecret())
  } catch (error) {
    if (!(error instanceof SecretInputCancelledError)) throw error
    console.error(chalk.red(`Error: ${error.message}`))
    return process.exit(CANCELLED_EXIT_CODE)
  }
}

async function setSecret(
  name: string,
  options: SetSecretOptions,
  command: Command,
  redactionSpellings: ReadonlySet<string>
): Promise<void> {
  if (redactionSpellings.size > 1) {
    throw new SimApiError(
      'Pass either --unredacted or --no-unredacted, not both: they are one setting, and commander keeps only whichever came last.',
      0
    )
  }
  const description = validateWorkspaceOnlyFlag('description', options.description, options.scope)
  const unredacted = validateWorkspaceOnlyFlag('unredacted', options.unredacted, options.scope)
  const value = await readSecretValue(options)
  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.setSecret
  const response = await client.request<SetSecretResponse>(resolvePath(operation.path, { name }), {
    method: operation.method,
    body: {
      workspaceId: client.requireWorkspace(),
      scope: options.scope,
      ...(value === undefined ? {} : { value }),
      description,
      ...(unredacted === undefined ? {} : { unredacted }),
    },
  })

  renderResult('setSecret', profile.output, response.data, SECRET_RESULT)
}

/** Adds interactive secret entry while preserving an explicit value flag for scripts. */
export function attachSecretCommands(program: Command): void {
  const secrets = program.commands.find((command) => command.name() === 'secrets')
  if (!secrets) throw new Error('The generated secrets command group is missing')

  /**
   * Which of the two spellings of the redaction setting were typed.
   *
   * They share one commander attribute, so passing both silently keeps the last
   * one — on the flag that decides whether the value is readable in plaintext.
   * The parsed options cannot show that, so the occurrences are recorded as
   * commander reports them.
   */
  const redactionSpellings = new Set<string>()

  secrets
    .command('set')
    .argument('<name>', 'Secret name, as referenced in workflows')
    .description(describeOperation(V2_OPERATIONS.setSecret, 'Create or replace a named secret'))
    .addOption(
      new Option('--scope <scope>', 'Secret ownership scope (required)')
        .choices([...SECRET_SCOPES])
        .makeOptionMandatory()
    )
    .option(
      '--value <value|@file>',
      'Secret value. Passing it inline exposes it to shell history and process listings; @path reads it from a file and @- from stdin, verbatim — a trailing newline is part of the value, so write the file with printf rather than echo. Prefix a literal leading @ with a second one'
    )
    .option(
      '--description <description>',
      'What the secret is for, shown to teammates; workspace scope only. Omit to leave an existing description unchanged'
    )
    .option(
      '--unredacted',
      `${V2_OPERATIONS.setSecret.body.unredacted.describe} Pass --no-unredacted to restore redaction`
    )
    .option('--no-unredacted', 'Send --unredacted as false')
    .on('option:unredacted', () => redactionSpellings.add('--unredacted'))
    .on('option:no-unredacted', () => redactionSpellings.add('--no-unredacted'))
    .action((name: string, options: SetSecretOptions, command: Command) =>
      setSecret(name, options, command, redactionSpellings)
    )
}
