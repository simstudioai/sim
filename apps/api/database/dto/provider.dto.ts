import { Type, type Static } from "@sinclair/typebox";

export const ProviderTypeEnum = Type.Union([
    Type.Literal("llm"),
    Type.Literal("embedding"),
    Type.Literal("storage"),
    Type.Literal("vector_db"),
    Type.Literal("other")
]);

export const ProviderSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    type: ProviderTypeEnum,
    api_key: Type.String(),
    base_url: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const ProviderCreateSchema = Type.Object({
    name: Type.String(),
    type: ProviderTypeEnum,
    api_key: Type.String(),
    base_url: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const ProviderUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    type: Type.Optional(ProviderTypeEnum),
    api_key: Type.Optional(Type.String()),
    base_url: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type ProviderType = Static<typeof ProviderTypeEnum>;
export type Provider = Static<typeof ProviderSchema>;
export type ProviderCreateType = Static<typeof ProviderCreateSchema>;
export type ProviderUpdateType = Static<typeof ProviderUpdateSchema>;