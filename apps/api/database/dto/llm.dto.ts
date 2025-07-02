import { Type, type Static } from "@sinclair/typebox";
import * as LLMProviderPrisma from "../generated/typebox/LLMProvider";

export const LLMProviderCreateSchema = Type.Object({
    name: Type.String(),
    api_key: Type.String(),
    base_url: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const LLMProviderUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    api_key: Type.Optional(Type.String()),
    base_url: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

// export type LLMProvider = Static<typeof LLMProviderPrisma.>;
export type LLMProviderCreateType = Static<typeof LLMProviderCreateSchema>;
export type LLMProviderUpdateType = Static<typeof LLMProviderUpdateSchema>;