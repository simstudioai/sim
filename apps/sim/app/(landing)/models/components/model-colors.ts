export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#D97757',
  openai: '#E8E8E8',
  google: '#4285F4',
  xai: '#555555',
  mistral: '#F7D046',
  groq: '#F55036',
  cerebras: '#6D5BF7',
  deepseek: '#4D6BFE',
  fireworks: '#FF6D3A',
  bedrock: '#FF9900',
}

const DEFAULT_COLOR = '#888888'

export function getProviderColor(providerId: string): string {
  return PROVIDER_COLORS[providerId] ?? DEFAULT_COLOR
}
