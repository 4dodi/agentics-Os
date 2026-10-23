import type { Goal } from "./types";

/** Milestone-driven goals derive their progress; goals without milestones keep the manual value. */
export function withProgress(g: Goal): Goal {
  if (!g.milestones.length) return g;
  return { ...g, progress: Math.round((g.milestones.filter((m) => m.done).length / g.milestones.length) * 100) };
}
