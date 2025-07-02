import { Type, type Static } from "@sinclair/typebox";

export const StepTypeEnum = Type.Union([
    Type.Literal("tool_execution"),
    Type.Literal("llm_call"),
    Type.Literal("user_input"),
    Type.Literal("system_action")
]);

export const StepStatusEnum = Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed")
]);

export const StepSchema = Type.Object({
    id: Type.String(),
    type: StepTypeEnum,
    status: StepStatusEnum,
    input: Type.Any(),
    output: Type.Optional(Type.Any()),
    error: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    run_id: Type.String(),
    parent_step_id: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const StepCreateSchema = Type.Object({
    type: StepTypeEnum,
    input: Type.Any(),
    run_id: Type.String(),
    parent_step_id: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const StepUpdateSchema = Type.Object({
    status: Type.Optional(StepStatusEnum),
    output: Type.Optional(Type.Any()),
    error: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type StepType = Static<typeof StepTypeEnum>;
export type StepStatus = Static<typeof StepStatusEnum>;
export type Step = Static<typeof StepSchema>;
export type StepCreateType = Static<typeof StepCreateSchema>;
export type StepUpdateType = Static<typeof StepUpdateSchema>;