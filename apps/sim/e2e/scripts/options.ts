const NAVIGATION_PROJECT = 'hosted-billing-chromium-navigation'
const WORKFLOWS_PROJECT = 'hosted-billing-chromium-workflows'
const FORBIDDEN_OPTIONS = [
  '--config',
  '-c',
  '--workers',
  '-j',
  '--retries',
  '--fully-parallel',
  '--pass-with-no-tests',
  '--list',
] as const

export interface E2eRunOptions {
  playwrightArgs: string[]
}

export function parseRunOptions(argv: string[]): E2eRunOptions {
  const normalizedArgs = argv[0] === '--' ? argv.slice(1) : [...argv]
  if (normalizedArgs.includes('--skip-build')) {
    throw new Error(
      '--skip-build remains disabled until the planned profile/source-keyed build reuse experiment proves it safe'
    )
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
  const playwrightArgs = [...normalizedArgs]
  const projects = getEqualsOptionValues(playwrightArgs, '--project')
  const unknownProject = projects.find(
    (project) => project !== NAVIGATION_PROJECT && project !== WORKFLOWS_PROJECT
  )
  if (unknownProject) throw new Error(`Unknown E2E Playwright project: ${unknownProject}`)
  const hasShard = hasOption(playwrightArgs, '--shard')

  if (
    hasShard &&
    (projects.length === 0 ||
      projects.includes(WORKFLOWS_PROJECT) ||
      projects.some((project) => project !== NAVIGATION_PROJECT))
  ) {
    throw new Error(
      `--shard is supported only with --project=${NAVIGATION_PROJECT}; coupled workflows must remain unsharded`
    )
  }

  return { playwrightArgs }
}

function hasOption(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

function getEqualsOptionValues(args: string[], name: string): string[] {
  return args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1))
}
