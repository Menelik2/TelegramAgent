#!/usr/bin/env bash
# Restore server/index.ts from last known good full server commit.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch origin
git checkout 3d87b29c495fafc6102ba2abbbc288e6a4f3028a -- server/index.ts
git add server/index.ts
git commit -m "fix: restore server/index.ts from 3d87b29"
git push origin HEAD:root
echo "Restored. Redeploy on Vercel."
