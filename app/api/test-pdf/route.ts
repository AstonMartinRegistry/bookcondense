import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      message:
        "Test endpoint is development-only. It does not ship in production builds.",
    },
    { status: 404 },
  );
}


