import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { zernioIntegrationEnabled } from "@/lib/zernio/config";
import { processZernioWebhook, verifyZernioSignature } from "@/lib/zernio/webhook";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  if (!zernioIntegrationEnabled()) return new Response("Not found", { status: 404 });
  const { connectionId } = await params;
  const connection = await prisma.zernioConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection?.enabled) return new Response("Not found", { status: 404 });

  const rawBody = await request.text();
  const signature = request.headers.get("x-zernio-signature");
  if (
    !verifyZernioSignature(
      rawBody,
      signature,
      decryptToken(connection.encryptedWebhookSecret)
    )
  ) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (
    payload &&
    typeof payload === "object" &&
    "event" in payload &&
    payload.event === "webhook.test"
  ) {
    return NextResponse.json({ success: true, test: true });
  }
  try {
    const result = await processZernioWebhook(connection.id, payload);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
