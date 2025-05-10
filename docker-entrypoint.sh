#!/bin/sh
# Ensure Bun environment is properly set up
export BUN_INSTALL=/root/.bun
export PATH=$BUN_INSTALL/bin:$PATH

cd apps/sim
bunx drizzle-kit push
cd ../..
exec "$@" 