import { Example } from "../generated/prisma/client";
import { faker } from "@faker-js/faker";
import { AbstractFactory } from "./AbstractFactory";

class TagFactory extends AbstractFactory<Example> {
	model = "example";

	async mapData(data: Partial<Example>): Promise<Example> {
		return {
			id: faker.string.uuid(),
			name: data.name || faker.word.noun(),
			description: data.description || faker.lorem.sentence(),
			createdAt: new Date(),
			updatedAt: new Date(),
			...data,
		}
	}
}

export default new ExampleFactory();