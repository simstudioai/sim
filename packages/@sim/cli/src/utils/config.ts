import Conf from 'conf'

// Config schema definition
interface ConfigSchema {
  port: string
  debug: boolean
  lastRun: string
}

// Create a config instance with default values
export const config = new Conf<ConfigSchema>({
  projectName: 'sim-studio',
  defaults: {
    port: '3000',
    debug: false,
    lastRun: new Date().toISOString(),
  },
})
