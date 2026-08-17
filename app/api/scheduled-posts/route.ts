import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { zernioIntegrationEnabled } from "@/lib/zernio/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!zernioIntegrationEnabled()) {
    return NextResponse.json({ success: true, data: [] });
  }
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");
  const posts = await prisma.scheduledPost.findMany({
    where: {
      workspaceId,
      ...(instagramAccountId ? { instagramAccountId } : {}),
      status: { in: ["SCHEDULED", "PUBLISHING"] },
    },
    select: {
      id: true,
      providerPostId: true,
      title: true,
      content: true,
      scheduledFor: true,
      timezone: true,
      mediaPreviewUrl: true,
      status: true,
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(
    { success: true, data: posts },
    { headers: { "Cache-Control": "no-store" } }
  );
}
