// Lists every channel connected to the Buffer account behind
// BUFFER_ACCESS_TOKEN, with its real channelId -- run this any time you
// connect a new channel (e.g. X/Twitter) to find the value to put in
// BUFFER_PROFILE_ID_LINKEDIN/_X. Run with: npx tsx scripts/list-buffer-channels.ts
import { listChannels } from "../src/clients/buffer.js";

async function main() {
  const channels = await listChannels();
  if (channels.length === 0) {
    console.log("No channels connected to this Buffer account at all -- connect one in Buffer's dashboard first.");
    return;
  }

  for (const c of channels) {
    console.log(
      `service=${c.service}  id=${c.id}  name="${c.displayName ?? c.name}"  ${c.isDisconnected ? "(DISCONNECTED)" : ""}`,
    );
  }
  console.log(
    "\nCopy the id for your linkedin/twitter channel into BUFFER_PROFILE_ID_LINKEDIN / BUFFER_PROFILE_ID_X.",
  );
}

main().catch((err) => {
  console.error("Failed to list Buffer channels:", err instanceof Error ? err.message : err);
  process.exit(1);
});
