import { Type, type Static } from "@sinclair/typebox"

export const MetadataDTO = Type.Object({
	utm_source: Type.Optional(Type.String()),
	utm_campaign: Type.Optional(Type.String()),
	utm_medium: Type.Optional(Type.String()),
	utm_term: Type.Optional(Type.String()),
	utm_content: Type.Optional(Type.String()),
});

export type MetadataDTOType = Static<typeof MetadataDTO>;