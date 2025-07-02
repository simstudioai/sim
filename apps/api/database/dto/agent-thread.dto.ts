import { Type, type Static } from "@sinclair/typebox";

export const AgentThreadSchema = Type.Object({
    id: Type.String(),
    agent_id: Type.String(),
    summary: Type.String(),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
});

export const AgentThreadCreateSchema = Type.Object({
    summary: Type.Optional(Type.String())
});

export const AgentThreadUpdateSchema = Type.Object({
    summary: Type.Optional(Type.String())
});

export type AgentThread = Static<typeof AgentThreadSchema>;
export type AgentThreadCreateType = Static<typeof AgentThreadCreateSchema>;
export type AgentThreadUpdateType = Static<typeof AgentThreadUpdateSchema>;