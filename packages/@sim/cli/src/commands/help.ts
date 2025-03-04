import chalk from 'chalk'
import { logo } from '../utils/logo'

/**
 * Help command displays the logo and usage information
 */
export function help() {
  // Display logo
  console.log(logo)

  // Display help text
  console.log(`
${chalk.bold('USAGE')}
  ${chalk.cyan('sim')}                    Start Sim Studio with default settings
  ${chalk.cyan('sim start')}              Start Sim Studio with options
  ${chalk.cyan('sim version')}            Display version information
  ${chalk.cyan('sim help')}               Show this help information

${chalk.bold('OPTIONS')}
  ${chalk.cyan('-p, --port <port>')}      Specify port (default: 3000)
  ${chalk.cyan('-d, --debug')}            Enable debug mode
  ${chalk.cyan('-v, --version')}          Show version information
  ${chalk.cyan('-h, --help')}             Show help information

${chalk.bold('EXAMPLES')}
  ${chalk.gray('# Start with default settings')}
  ${chalk.cyan('$ sim')}

  ${chalk.gray('# Start on a specific port')}
  ${chalk.cyan('$ sim start --port 8080')}

  ${chalk.gray('# Start with debug logging')}
  ${chalk.cyan('$ sim start --debug')}

${chalk.bold('DOCUMENTATION')}
  ${chalk.gray('For more information:')}
  https://github.com/simstudioai/sim
  `)
}
