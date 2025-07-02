import { Type, type Static } from "@sinclair/typebox"

export const BaseResSchema = Type.Object({
	success: Type.Boolean(),
});

export type BaseResType = Static<typeof BaseResSchema>;