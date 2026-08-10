import { NextResponse } from "next/server";
import { getBuildId } from "@/lib/build-id";

export async function GET() {
  return NextResponse.json(
    { buildId: getBuildId() },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
