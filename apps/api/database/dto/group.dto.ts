import { Type, type Static } from "@sinclair/typebox";

export const GroupSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any()),
    agent_ids: Type.Array(Type.String())
});

export const GroupCreateSchema = Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    agent_ids: Type.Array(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const GroupUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    agent_ids: Type.Optional(Type.Array(Type.String())),
    metadata: Type.Optional(Type.Any())
});

export type Group = Static<typeof GroupSchema>;
export type GroupCreateType = Static<typeof GroupCreateSchema>;
export type GroupUpdateType = Static<typeof GroupUpdateSchema>;