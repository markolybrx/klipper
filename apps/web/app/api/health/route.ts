import { NextResponse } from "next/server";

export async function GET() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
  ];
  const missing = required.filter((key) => !process.env[key]);
  return NextResponse.json(
    { status: missing.length === 0 ? "ok" : "missing_env_vars", missing },
    { status: missing.length === 0 ? 200 : 500 }
  );
}
