#!/bin/sh
cd apps/sim
npx drizzle-kit push
cd ../..
exec "$@" 