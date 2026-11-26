/**
 * How a host that runs the CLI for an agent tells it so. Kept free of imports, so a host's server
 * code reads these names without loading the CLI.
 */

/**
 * Set to {@link MOTHERSHIP_CLI_HOST} in the environment of the CLI that Mothership's workbench
 * runs (an embedding call passes it as `host` instead), so the source primer and help it gives
 * are the chat ones (`PrimerSurface`).
 */
export const CLI_HOST_ENV = 'SIM_CLI_HOST'

export const MOTHERSHIP_CLI_HOST = 'mothership'
