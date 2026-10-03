/** Event detail for OAuth connect events dispatched by the copilot. */
export interface OAuthConnectEventDetail {
  providerName: string
  serviceId: string
  providerId: string
  requiredScopes: string[]
  newScopes?: string[]
}
