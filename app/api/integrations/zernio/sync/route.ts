import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { zernioIntegrationEnabled } from "@/lib/zernio/config";
import { syncZernioConnection } from "@/lib/zernio/sync";

export async function POST() {
  if (!zernioIntegrationEnabled()) {
    return NextResponse.json({ success: false, error: "Zernio integration is disabled" }, { status: 404 });
  }
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const connection = await prisma.zernioConnection.findUnique({
    where: { workspaceId: context.workspaceId },
  });
  if (!connection) {
    return NextResponse.json({ success: false, error: "Zernio is not connected" }, { status: 404 });
  }
  try {
    const result = await syncZernioConnection(connection.id);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zernio sync failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
