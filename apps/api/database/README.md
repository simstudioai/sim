# Prisma

> ⚠️ Run the commands below from the root directory (e.g. `site/backend`)

|Description|Command|
|-|-|
|Rebuild Schema|`npx prisma generate`|
|DEV: Push state of Schema to DB|`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma db push`|
|DEV: Pull state of DB to Schema|`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma db pull`|
|DEV: Run Seed (from root dir!)|`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma db seed`|
|Create Migration|`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma migrate dev`|
|Run Migration in Prod/Stag|`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma migrate deploy`|
|Reset Database with Seed (from root dir!)|`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma migrate reset`|






OLD COMMANDS

## Generate Client Library

When you have created your schema or updated it, run the command below to build the [Client Library](https://www.prisma.io/docs/getting-started/setup-prisma/add-to-existing-project/install-prisma-client-typescript-postgres).

```bash
npx prisma generate
```

## Upgrading Database Scheme

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma db push
```

## Creating migrations

https://www.prisma.io/docs/concepts/components/prisma-migrate

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma migrate dev --name init --preview-feature
```

## Opening Prisma Studio

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma studio
```

## Running Seeds

```bash
# First time
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma db seed --preview-feature

# Afterwards
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrydoncom" npx prisma migrate reset
```

> Note: the dropping of the data might fail due to the Database being busy. To drop these, execute the command below

```sql
-- Terminate open connections on the database
SELECT pid, pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = current_database() AND pid <> pg_backend_pid();

-- Drop and Recreate (not on production!!!)
DROP DATABASE scrydoncom;
CREATE DATABASE scrydoncom;
```