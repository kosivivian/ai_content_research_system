import { YoutubeTranscript } from "youtube-transcript";

/** Free, no-API-key transcript fetch, used for youtube.com/youtu.be supporting-material links. */
export async function fetchTranscript(url: string): Promise<string> {
  const segments = await YoutubeTranscript.fetchTranscript(url);
  return segments.map((segment) => segment.text).join(" ");
}
