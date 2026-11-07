import type { ComponentType } from 'react'
import {
  AnthropicIcon,
  AzureIcon,
  BasetenIcon,
  BedrockIcon,
  CerebrasIcon,
  DeepseekIcon,
  FireworksIcon,
  GeminiIcon,
  GroqIcon,
  KieIcon,
  KimiIcon,
  LitellmIcon,
  MetaIcon,
  MistralIcon,
  NvidiaIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  SakanaIcon,
  TogetherIcon,
  TypeSafeIcon,
  VertexIcon,
  VllmIcon,
  xAIIcon,
  ZaiIcon,
} from '@/components/icons'
import { NebiusIcon } from '@/components/icons/nebius'
import { ThinkingMachinesIcon } from '@/components/icons/thinking-machines'

/**
 * Provider brand marks, keyed by the `providerId` the server resolves.
 *
 * Kept here rather than read from `PROVIDER_DEFINITIONS`: that module carries the
 * whole model registry and would land in this settings chunk for two dozen glyphs.
 * The icons themselves come from the same `@/components/icons` module the registry
 * imports, so this is a re-keying, never a second set of artwork.
 *
 * It must list every provider the registry defines, or a model resolving to a
 * missing one renders an unexplained blank where every neighbouring row has a mark.
 */
export const PROVIDER_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  anthropic: AnthropicIcon,
  baseten: BasetenIcon,
  bedrock: BedrockIcon,
  cerebras: CerebrasIcon,
  deepseek: DeepseekIcon,
  fireworks: FireworksIcon,
  google: GeminiIcon,
  groq: GroqIcon,
  kie: KieIcon,
  kimi: KimiIcon,
  litellm: LitellmIcon,
  meta: MetaIcon,
  mistral: MistralIcon,
  nebius: NebiusIcon,
  nvidia: NvidiaIcon,
  ollama: OllamaIcon,
  'ollama-cloud': OllamaIcon,
  openai: OpenAIIcon,
  openrouter: OpenRouterIcon,
  sakana: SakanaIcon,
  thinkingmachines: ThinkingMachinesIcon,
  together: TogetherIcon,
  typesafe: TypeSafeIcon,
  vertex: VertexIcon,
  vllm: VllmIcon,
  xai: xAIIcon,
  zai: ZaiIcon,
  'azure-anthropic': AzureIcon,
  /** Not a registry provider — a BYOK credential kind the breakdown can also emit. */
  'azure-openai': AzureIcon,
}
