"use client";

import { motion } from "framer-motion";

/**
 * Purely decorative -- a slow drifting gradient behind the dashboard
 * header, so the app doesn't read as a bare CRUD screen. Deliberately not
 * a full 3D scene: one accent on one page, not 3D everywhere.
 */
export function HeroAccent() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl">
      <motion.div
        className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-gradient-to-br from-indigo-400/30 to-violet-300/30 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 20, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-gradient-to-br from-sky-300/30 to-indigo-300/30 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -15, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
