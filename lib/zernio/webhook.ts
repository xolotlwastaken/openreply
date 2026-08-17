import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { accountReferenceId, zernioWebhookPayloadSchema } from "@/lib/zernio/types";
import { applyZernioWebhookPost } from "@/lib/zernio/sync";

export function verifyZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.trim().toLowerCase().replace(/^sha256=/, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function webhookAccountId(payload: ReturnType<typeof zernioWebhookPayloadSchema.parse>) {
  return (
    payload.account?.accountId ??
    payload.account?.id ??
    accountReferenceId(payload.platform?.accountId) ??
    null
  );
}

export async function processZernioWebhook(
  connectionId: string,
  rawPayload: unknown
): Promise<{ duplicate: boolean; bound: boolean }> {
  const payload = zernioWebhookPayloadSchema.parse(rawPayload);
  const existing = await prisma.zernioWebhookEvent.findUnique({
    where: { eventId: payload.id },
  });
  if (existing?.status === "PROCESSED") return { duplicate: true, bound: false };
  if (!existing) {
    try {
      await prisma.zernioWebhookEvent.create({
        data: {
          eventId: payload.id,
          zernioConnectionId: connectionId,
          event: payload.event,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { duplicate: true, bound: false };
      }
      throw error;
    }
  } else {
    await prisma.zernioWebhookEvent.update({
      where: { eventId: payload.id },
      data: { status: "PENDING", errorMessage: null },
    });
  }

  try {
    let bound = false;
    const targets = payload.platform ? [payload.platform] : payload.post.platforms;
    for (const target of targets) {
      if (target.platform.toLowerCase() !== "instagram") continue;
      const accountId =
        payload.platform === target
          ? webhookAccountId(payload)
          : accountReferenceId(target.accountId);
      if (!accountId) continue;
      const record = await applyZernioWebhookPost(connectionId, payload.post, target, accountId);
      bound = bound || Boolean(record?.platformPostId);
    }

    await prisma.zernioWebhookEvent.update({
      where: { eventId: payload.id },
      data: { status: "PROCESSED", processedAt: new Date(), errorMessage: null },
    });
    return { duplicate: false, bound };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    await prisma.zernioWebhookEvent
      .update({
        where: { eventId: payload.id },
        data: { status: "FAILED", errorMessage: message.slice(0, 2000) },
      })
      .catch(() => {});
    throw error;
  }
}
