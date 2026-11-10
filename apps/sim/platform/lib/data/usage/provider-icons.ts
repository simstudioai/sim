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
 * Model provider brand marks, keyed by the `providerId` the usage breakdown resolves. The design
 * system's provider marks know integration ids only, so every model provider would otherwise show
 * the generic mark. Kept apart from `PROVIDER_DEFINITIONS`, whose model registry would land in the
 * Settings chunk for these glyphs; `provider-icons.test.ts` fails when the two drift.
 */
export const MODEL_PROVIDER_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> =
  {
    anthropic: AnthropicIcon,
    'azure-anthropic': AzureIcon,
    'azure-openai': AzureIcon,
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
  }
