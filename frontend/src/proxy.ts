import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the "middleware" file convention to "proxy" -- same
// mechanism (runs before routes render), just a clearer name for it.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets and Next internals; run on everything else so the
    // session cookie stays fresh and unauthenticated visitors get redirected.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
