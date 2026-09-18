"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { Channel, ChannelDraft, PublishingQueueItem, PublishingStatus } from "@/lib/types/db";

type BufferChannel = "linkedin" | "x";

const CHANNEL_LABEL: Record<Channel, string> = {
  linkedin: "LinkedIn",
  x: "X",
  email: "Email newsletter",
};

const STATUS_VARIANT: Record<PublishingStatus, BadgeProps["variant"]> = {
  queued: "default",
  processing: "warning",
  scheduled: "success",
  published: "success",
  failed: "danger",
};

/**
 * Shown once a request is approved (or already scheduled -- a creator can
 * queue more channels later). Buffer only publishes to social profiles, so
 * email never goes through publishing_queue at all; its draft is just shown
 * here for a manual copy/paste per the PRD's "flag for manual send" rule.
 */
export function SchedulingPanel({
  requestId,
  channelDrafts,
  queueItems,
}: {
  requestId: string;
  channelDrafts: ChannelDraft[];
  queueItems: PublishingQueueItem[];
}) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<BufferChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const emailDraft = channelDrafts.find((d) => d.channel === "email");
  const socialDrafts = channelDrafts.filter((d) => d.channel !== "email");

  async function schedule(channel: BufferChannel) {
    setError(null);
    setSubmitting(channel);
    try {
      const supabase = createClient();
      const localValue = scheduledAt[channel];
      const { error: insertError } = await supabase.from("publishing_queue").insert({
        request_id: requestId,
        channel,
        scheduled_time: localValue ? new Date(localValue).toISOString() : null,
      });
      if (insertError) throw new Error(insertError.message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function copyEmail() {
    if (!emailDraft) return;
    await navigator.clipboard.writeText(emailDraft.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Schedule &amp; publish</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {socialDrafts.map((draft) => {
          const channel = draft.channel as BufferChannel;
          const itemsForChannel = queueItems.filter((q) => q.channel === channel);
          return (
            <div
              key={draft.id}
              className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0"
            >
              <p className="text-sm font-medium">{CHANNEL_LABEL[channel]}</p>

              {itemsForChannel.length > 0 && (
                <div className="flex flex-col gap-1">
                  {itemsForChannel.map((q) => (
                    <div key={q.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={STATUS_VARIANT[q.status]}>{q.status}</Badge>
                      <span>{q.scheduled_time ? new Date(q.scheduled_time).toLocaleString() : "post immediately"}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="datetime-local"
                  className="w-auto"
                  value={scheduledAt[channel] ?? ""}
                  onChange={(e) => setScheduledAt((prev) => ({ ...prev, [channel]: e.target.value }))}
                />
                <Button size="sm" disabled={submitting !== null} onClick={() => schedule(channel)}>
                  {submitting === channel ? "Queuing..." : "Schedule"}
                </Button>
                <span className="text-xs text-muted-foreground">Leave blank to post as soon as Buffer picks it up.</span>
              </div>
            </div>
          );
        })}

        {emailDraft && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{CHANNEL_LABEL.email}</p>
            <p className="text-xs text-muted-foreground">
              Buffer doesn&apos;t publish email -- copy this draft into your ESP and send it yourself.
            </p>
            <Button size="sm" variant="outline" onClick={copyEmail} className="w-fit">
              {copied ? "Copied" : "Copy email body"}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
