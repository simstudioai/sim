const NAVIGATION_PROJECT = 'hosted-billing-chromium-navigation'
const AUTHORIZATION_PROJECT = 'hosted-billing-chromium-authorization'
const CREDENTIALS_PROJECT = 'hosted-billing-chromium-credentials'
const WORKFLOWS_PROJECT = 'hosted-billing-chromium-workflows'
const PERSONAS_PROJECT = 'hosted-billing-chromium-personas'
const PERSONA_ISOLATION_PROJECT = 'hosted-billing-chromium-persona-isolation'
const E2E_PROJECTS = new Set([
  NAVIGATION_PROJECT,
  AUTHORIZATION_PROJECT,
  CREDENTIALS_PROJECT,
  WORKFLOWS_PROJECT,
  PERSONAS_PROJECT,
  PERSONA_ISOLATION_PROJECT,
])
const FORBIDDEN_OPTIONS = [
  '--config',
  '-c',
  '--workers',
  '-j',
  '--retries',
  '--fully-parallel',
  '--pass-with-no-tests',
  '--list',
  '--output',
  '--output-dir',
  '--reporter',
  '--trace',
  '--timeout',
  '--debug',
  '--ui',
] as const
const SAFE_BOOLEAN_OPTIONS = new Set(['--no-deps', '--headed', '--quiet'])
const SAFE_VALUE_OPTIONS = new Set(['--grep', '--grep-invert', '--repeat-each', '-g'])

export interface E2eRunOptions {
  playwrightArgs: string[]
  reuseBuild: boolean
}

export function parseRunOptions(
  argv: string[],
  environment: { ci: boolean } = { ci: process.env.CI === 'true' }
): E2eRunOptions {
  const normalizedArgs = argv[0] === '--' ? argv.slice(1) : [...argv]
  if (normalizedArgs.includes('--skip-build')) {
    throw new Error(
      '--skip-build remains disabled until the planned profile/source-keyed build reuse experiment proves it safe'
    )
  }
  if (hasOption(normalizedArgs, '--keep-stack')) {
    throw new Error(
      '--keep-stack is unavailable: the all-or-nothing retained-stack safety experiment was deferred'
    )
  }
  if (normalizedArgs.some((arg) => arg.startsWith('--reuse-build='))) {
    throw new Error('Use --reuse-build without a value')
  }
  const reuseBuild = normalizedArgs.includes('--reuse-build')
  if (reuseBuild && environment.ci) {
    throw new Error('--reuse-build is local-only; CI must run a fresh one-shot build')
  }
  if (hasOption(normalizedArgs, '--no-deps') && environment.ci) {
    throw new Error('--no-deps is local-only; CI must run the complete project dependency chain')
  }
  if (normalizedArgs.some((arg) => arg.startsWith('--no-deps='))) {
    throw new Error('Use --no-deps without a value')
  }
  for (const option of FORBIDDEN_OPTIONS) {
    if (hasOption(normalizedArgs, option)) {
      throw new Error(`${option} cannot override E2E orchestration invariants`)
    }
  }
  if (normalizedArgs.includes('--project')) {
    throw new Error('Use canonical --project=<name> syntax')
  }
  if (normalizedArgs.includes('--shard')) {
    throw new Error('Use canonical --shard=<current/total> syntax')
  }
  const playwrightArgs = normalizedArgs.filter((arg) => arg !== '--reuse-build')
  assertSupportedPlaywrightArgs(playwrightArgs)
  const projects = getEqualsOptionValues(playwrightArgs, '--project')
  const unknownProject = projects.find((project) => !E2E_PROJECTS.has(project))
  if (unknownProject) throw new Error(`Unknown E2E Playwright project: ${unknownProject}`)
  if (normalizedArgs.includes('--no-deps') && projects.length !== 1) {
    throw new Error('--no-deps requires exactly one explicit canonical --project=<name>')
  }
  const hasShard = hasOption(playwrightArgs, '--shard')

  if (
    hasShard &&
    (projects.length === 0 ||
      projects.includes(WORKFLOWS_PROJECT) ||
      projects.some((project) => project !== NAVIGATION_PROJECT))
  ) {
    throw new Error(
      `--shard is supported only with --project=${NAVIGATION_PROJECT}; coupled E2E projects must remain unsharded`
    )
  }

  return { playwrightArgs, reuseBuild }
}

function assertSupportedPlaywrightArgs(args: string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('-')) continue
    if (SAFE_BOOLEAN_OPTIONS.has(argument)) continue
    if (argument.startsWith('--project=') || argument.startsWith('--shard=')) continue
    const equalsName = argument.includes('=') ? argument.slice(0, argument.indexOf('=')) : argument
    if (SAFE_VALUE_OPTIONS.has(equalsName) && argument.includes('=')) continue
    if (SAFE_VALUE_OPTIONS.has(argument)) {
      if (args[index + 1] === undefined) {
        throw new Error(`${argument} requires a value`)
      }
      index += 1
      continue
    }
    throw new Error(
      `${argument} is not a supported E2E Playwright option; artifact and orchestration overrides are denied`
    )
  }
}

function hasOption(args: string[], name: string): boolean {
  if (name.startsWith('-') && !name.startsWith('--')) {
    return args.some((arg) => arg === name || arg.startsWith(name))
  }
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

function getEqualsOptionValues(args: string[], name: string): string[] {
  return args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1))
}
