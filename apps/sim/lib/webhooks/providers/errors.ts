export class WebhookDeploymentConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookDeploymentConfigurationError'
  }
}
