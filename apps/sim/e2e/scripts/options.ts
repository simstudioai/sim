const NAVIGATION_PROJECT = 'hosted-billing-chromium-navigation'
const WORKFLOWS_PROJECT = 'hosted-billing-chromium-workflows'

export interface E2eRunOptions {
  playwrightArgs: string[]
  skipBuild: boolean
}

export function parseRunOptions(argv: string[]): E2eRunOptions {
  const normalizedArgs = argv[0] === '--' ? argv.slice(1) : [...argv]
  const skipBuild = normalizedArgs.includes('--skip-build')
  const playwrightArgs = normalizedArgs.filter((arg) => arg !== '--skip-build')
  const projects = getOptionValues(playwrightArgs, '--project')
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

  return { playwrightArgs, skipBuild }
}

function hasOption(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

function getOptionValues(args: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1))
    } else if (arg === name && args[index + 1]) {
      values.push(args[index + 1])
      index += 1
    }
  }
  return values
}
