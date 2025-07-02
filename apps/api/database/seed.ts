import { client } from "./client";
import { DataGenerator } from "./data-generator";

async function main() {
	await DataGenerator.seed();
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await client.$disconnect();
	});
