import { Type, type Static } from "@sinclair/typebox";

export const TagSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    color: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const TagCreateSchema = Type.Object({
    name: Type.String(),
    color: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const TagUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    color: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type TagType = Static<typeof TagSchema>;
export type TagCreateType = Static<typeof TagCreateSchema>;
export type TagUpdateType = Static<typeof TagUpdateSchema>;