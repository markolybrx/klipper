#!/usr/bin/env bash
set -e

# Run this from inside the klipper/ directory created by setup_klipper.sh

if [ ! -d "apps/web" ]; then
  echo "Error: run this from inside the klipper/ directory (apps/web not found)."
  exit 1
fi

echo "Removing apps/api — superseded by Next.js Route Handlers in apps/web/app/api"
rm -rf apps/api

# --- root workspace config ---
cat > package.json << 'EOF'
{
  "name": "klipper",
  "private": true,
  "workspaces": [
    "apps/web",
    "packages/*"
  ]
}
EOF

# --- apps/web: real Next.js scaffold ---
mkdir -p apps/web/app/api/health

cat > apps/web/package.json << 'EOF'
{
  "name": "@klipper/web",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=18.17.0"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/node": "^20.14.0"
  }
}
EOF

cat > apps/web/next.config.js << 'EOF'
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for monorepos: ensures Next.js correctly traces dependencies
  // from packages/* outside the apps/web root when bundling functions.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

module.exports = nextConfig;
EOF

cat > apps/web/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF

cat > apps/web/app/layout.tsx << 'EOF'
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klipper",
  description: "AI-assisted video clipping and publishing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
EOF

cat > apps/web/app/globals.css << 'EOF'
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
EOF

cat > apps/web/app/page.tsx << 'EOF'
export default function Home() {
  return (
    <main style={{ padding: "2rem" }}>
      <h1>Klipper</h1>
      <p>Deployment scaffold — editor and dashboard not yet implemented.</p>
    </main>
  );
}
EOF

cat > apps/web/app/api/health/route.ts << 'EOF'
import { NextResponse } from "next/server";

// Verifies required environment variables are present in this deployment.
// Does not call Supabase directly — a missing/invalid key should fail
// at the point of use with a clear error, not be masked by a health check.
export async function GET() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);

  return NextResponse.json(
    {
      status: missing.length === 0 ? "ok" : "missing_env_vars",
      missing,
    },
    { status: missing.length === 0 ? 200 : 500 }
  );
}
EOF

echo ""
echo "Next.js app scaffolded in apps/web."
echo "apps/api removed — its routes now live in apps/web/app/api."
echo "Next: see DEPLOY_VERCEL.md"
