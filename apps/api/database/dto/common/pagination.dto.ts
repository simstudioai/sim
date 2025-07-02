import { Type, type Static } from "@sinclair/typebox"

export const PaginationMetaSchema = Type.Object({
	page: Type.Number(),
	take: Type.Number(),
	itemCount: Type.Number(),
	pageCount: Type.Number(),
	hasPreviousPage: Type.Boolean(),
	hasNextPage: Type.Boolean(),
});

export const PaginationOptionsSchema = Type.Optional(Type.Object({
	page: Type.Optional(Type.Number({ default: 1 })),
	take: Type.Optional(Type.Number({ default: 10 })),
	filter: Type.Optional(Type.String({})),

	// // ?orderBy=<KEY>:DESC,<KEY2>:ASC
	orderBy: Type.Optional(Type.String()),
}));

export type PaginationMetaType = Static<typeof PaginationMetaSchema>;
export type PaginationOptionsType = Static<typeof PaginationOptionsSchema>;


export interface PaginationType<T> {
	// @ts-ignore
	data: T[];

	// @ts-ignore
	meta: PaginationMetaDTO;
}