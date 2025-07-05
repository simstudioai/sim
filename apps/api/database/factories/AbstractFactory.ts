import { PrismaClient } from "../generated/prisma";

export abstract class AbstractFactory<T> {
	abstract mapData(data?: Partial<T>): Promise<T>;
	abstract model: string;

	async createManyByData(
		prisma: PrismaClient,
		data: Partial<T>[],
	): Promise<T[]> {
		const mapped = await Promise.all(data.map((d) => this.mapData(d)));

		// Create the entities
		try {
			await (prisma as any)[this.model].createMany({
				data: mapped,
			});
		} catch (e) {
			console.log(`An error occured while creating the data for model '${this.model}': ${e}`);
		}

		return mapped;
	}

	async createMany(
		prisma: PrismaClient,
		amount = 1,
		data: Partial<T> = {}
	): Promise<T[]> {
		return this.createManyByData(prisma, Array(amount).fill(data));
	}

	async create(
		prisma: PrismaClient,
		data: Partial<T> = {},
	): Promise<T> {
		return (await this.createMany(prisma, 1, data))[0];
	}
}