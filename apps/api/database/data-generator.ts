import { PrismaClient, Prisma } from "./generated/prisma/client";

const prisma = new PrismaClient();

export type SeedData = {
	users: {
		user1: User;
		user2: User;
		user3: User;
		user4: User;
		user5: User;
		userAdmin1: User;
		userAdmin2: User;
		extra: User[];
	};
	userSessions: {
		user1: UserSession;
		user2: UserSession;
		user3: UserSession;
		user4: UserSession;
		user5: UserSession;
		userAdmin1: UserSession;
		userAdmin2: UserSession;
	};
};

export class DataGenerator {
	static async seed(): Promise<SeedData> {
		// First clean everything
		await DataGenerator.clean();

		// Create users
		//const u1 = await UserFactory.create(prisma, { email: "user@example.com", password: "DemoUser@123!" });
		//const u2 = await UserFactory.create(prisma, { email: "user2@example.com", password: "DemoUser@123!" });
		//const u3 = await UserFactory.create(prisma, { email: "user3@example.com", password: "DemoUser@123!" });
		const u1 = await UserFactory.create(prisma, { email: "user@example.com" });
		const u2 = await UserFactory.create(prisma, { email: "pfizer@example.com" });
		const u3 = await UserFactory.create(prisma, { email: "johndeere@example.com" });
		const u4 = await UserFactory.create(prisma, { email: "pg@example.com" });
		const u5 = await UserFactory.create(prisma, { email: "jpmorgan@example.com" });
		const u_a1 = await UserFactory.create(prisma, { email: "useradmin1@example.com" });
		const u_a2 = await UserFactory.create(prisma, { email: "useradmin2@example.com" });
		const u_extra = await UserFactory.createMany(prisma, 10);

		// Create User Sessions
		const us1 = await UserSessionFactory.create(prisma, { userId: u1.id });
		const us2 = await UserSessionFactory.create(prisma, { userId: u2.id });
		const us3 = await UserSessionFactory.create(prisma, { userId: u3.id });
		const us4 = await UserSessionFactory.create(prisma, { userId: u4.id });
		const us5 = await UserSessionFactory.create(prisma, { userId: u5.id });
		const us_a1 = await UserSessionFactory.create(prisma, { userId: u_a1.id });
		const us_a2 = await UserSessionFactory.create(prisma, { userId: u_a2.id });

		return {
			users: {
				user1: u1,
				user2: u2,
				user3: u3,
				user4: u4,
				user5: u5,
				userAdmin1: u_a1,
				userAdmin2: u_a2,
				extra: u_extra,
			},
			userSessions: {
				user1: us1,
				user2: us2,
				user3: us3,
				user4: us4,
				user5: us5,
				userAdmin1: us_a1,
				userAdmin2: us_a2,
			},
		};
	}

	static async clean() {
		try {
			// Get all the tables
			const tables = (await prisma.$queryRaw`
			SELECT TABLENAME
			FROM pg_tables
			WHERE schemaname = CURRENT_SCHEMA();
		  	`) as { tablename: string }[];

			// Get the names
			const tableNames = tables.map((table) => `"${table.tablename}"`);

			const query = Prisma.sql`TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE;`;

			// Truncate them in one query
			// https://www.postgresql.org/docs/current/sql-truncate.html
			await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE;`);
		} catch (e) {
			console.error("Error while cleaning the database:", e);
			throw e;
		} finally {
			await prisma.$disconnect();
		}
	}
}