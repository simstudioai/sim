#!/bin/sh
set -e

cd apps/sim
bunx drizzle-kit push
cd ../..

bun run start --host "0.0.0.0"