import { Type, type Static } from "@sinclair/typebox";

export const VoiceSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    provider: Type.String(),
    voice_id: Type.String(),
    language: Type.String(),
    gender: Type.Union([
        Type.Literal("male"),
        Type.Literal("female"),
        Type.Literal("neutral")
    ]),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const VoiceCreateSchema = Type.Object({
    name: Type.String(),
    provider: Type.String(),
    voice_id: Type.String(),
    language: Type.String(),
    gender: Type.Union([
        Type.Literal("male"),
        Type.Literal("female"),
        Type.Literal("neutral")
    ]),
    metadata: Type.Optional(Type.Any())
});

export const VoiceUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    voice_id: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
    gender: Type.Optional(Type.Union([
        Type.Literal("male"),
        Type.Literal("female"),
        Type.Literal("neutral")
    ])),
    metadata: Type.Optional(Type.Any())
});

export const TextToSpeechRequestSchema = Type.Object({
    text: Type.String(),
    voice_id: Type.String(),
    speed: Type.Optional(Type.Number()),
    pitch: Type.Optional(Type.Number())
});

export const TextToSpeechResponseSchema = Type.Object({
    audio_url: Type.String(),
    duration_seconds: Type.Number(),
    text: Type.String()
});

export type Voice = Static<typeof VoiceSchema>;
export type VoiceCreateType = Static<typeof VoiceCreateSchema>;
export type VoiceUpdateType = Static<typeof VoiceUpdateSchema>;
export type TextToSpeechRequest = Static<typeof TextToSpeechRequestSchema>;
export type TextToSpeechResponse = Static<typeof TextToSpeechResponseSchema>;