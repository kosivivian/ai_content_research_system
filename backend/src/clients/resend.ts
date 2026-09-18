import { Resend } from "resend";
import { loadEnv } from "../config/env.js";

let client: Resend | undefined;

function getClient(): Resend {
  if (client) return client;
  const env = loadEnv();
  client = new Resend(env.RESEND_API_KEY);
  return client;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const env = loadEnv();
  const { error } = await getClient().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    html,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

export async function sendErrorEmail(
  to: string,
  info: { requestId: string; stage: string; detail: Record<string, unknown> },
): Promise<void> {
  await sendEmail(
    to,
    `[Content Agent] Pipeline error on request ${info.requestId}`,
    `<p>Stage <strong>${info.stage}</strong> failed after the maximum retry attempts.</p>
     <pre>${escapeHtml(JSON.stringify(info.detail, null, 2))}</pre>`,
  );
}

export async function sendApprovalDecisionEmail(
  to: string,
  info: { requestId: string; decision: "approved" | "rejected"; comments?: string | null },
): Promise<void> {
  const verb = info.decision === "approved" ? "approved" : "sent back with changes requested";
  await sendEmail(
    to,
    `[Content Agent] Request ${info.requestId} was ${verb}`,
    `<p>Your content request was <strong>${verb}</strong>.</p>
     ${info.comments ? `<p>Reviewer comments: ${escapeHtml(info.comments)}</p>` : ""}`,
  );
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
