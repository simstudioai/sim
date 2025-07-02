import { Type, type Static } from "@sinclair/typebox";

export const SourceSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    content: Type.String(),
    metadata: Type.Optional(Type.Any()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String()
});

export const SourceCreateSchema = Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    content: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const SourceUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    content: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type Source = Static<typeof SourceSchema>;
export type SourceCreateType = Static<typeof SourceCreateSchema>;
export type SourceUpdateType = Static<typeof SourceUpdateSchema>;