import { ModelEndpointType } from "../generated/prisma";
import { EnumEntry } from "../lib/enum.util";

export const ModelEndpointTypeEnum = ModelEndpointType;

export const getModelEndpointTypeEnumEntries = (): EnumEntry[] => [
    { key: ModelEndpointTypeEnum.OPENAI, value: "OpenAI" },
    { key: ModelEndpointTypeEnum.ANTHROPIC, value: "Anthropic" },
    { key: ModelEndpointTypeEnum.COHERE, value: "Cohere" },
    { key: ModelEndpointTypeEnum.GOOGLE_AI, value: "Google AI" },
    { key: ModelEndpointTypeEnum.GOOGLE_VERTEX, value: "Google Vertex" },
    { key: ModelEndpointTypeEnum.AZURE, value: "Azure" },
    { key: ModelEndpointTypeEnum.GROQ, value: "Groq" },
    { key: ModelEndpointTypeEnum.OLLAMA, value: "oLLAMA" },
    { key: ModelEndpointTypeEnum.WEBUI, value: "WebUI" },
    { key: ModelEndpointTypeEnum.WEBUI_LEGACY, value: "webUI Legacy" },
    { key: ModelEndpointTypeEnum.LMSTUDIO, value: "LM Studio" },
    { key: ModelEndpointTypeEnum.LMSTUDIO_LEGACY, value: "LM Studio (Legacy)" },
    { key: ModelEndpointTypeEnum.LMSTUDIO_CHATCOMPLETIONS, value: "LM Studio (ChatCompletions)" },
    { key: ModelEndpointTypeEnum.LLAMACPP, value: "LLAMACPP" },
    { key: ModelEndpointTypeEnum.KOBOLDCPP, value: "KOBOLDCPP" },
    { key: ModelEndpointTypeEnum.VLLM, value: "vLLM" },
    { key: ModelEndpointTypeEnum.HUGGING_FACE, value: "Hugging Faces" },
    { key: ModelEndpointTypeEnum.MISTRAL, value: "Mistral" },
    { key: ModelEndpointTypeEnum.TOGETHER, value: "Together" },
    { key: ModelEndpointTypeEnum.BEDROCK, value: "Bedrock" },
    { key: ModelEndpointTypeEnum.DEEPSEEK, value: "Deepseek" },
    { key: ModelEndpointTypeEnum.XAI, value: "xAI" },
];
