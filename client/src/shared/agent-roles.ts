/**
 * Canonical source of agent role metadata.
 *
 * Both the PixiJS renderer (which needs hex numbers like 0x40ff80) and the
 * React UI (which needs CSS strings like "#40ff80") import from here so the
 * data is never duplicated.
 */

import { PALETTE } from "../pixi/palette";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Convert a 24-bit hex number (e.g. 0x40ff80) to a CSS hex string ("#40ff80"). */
export function toHexString(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// Role badge colors
// ---------------------------------------------------------------------------

/** Canonical badge colors as PixiJS hex numbers — consumed by draw-agent.ts. */
export const ROLE_BADGE_COLORS: Record<string, number> = {
  "frontend-developer":      0x40ff80,
  "backend-developer":       0x40ff80,
  "mobile-developer":        0x40ff80,
  "mobile-app-developer":    0x40ff80,
  "debugger":                0x40ddff,
  "code-reviewer":           0x40ddff,
  "security-auditor":        0x40ddff,
  "security-engineer":       0x40ddff,
  "ui-designer":             0xff40aa,
  "content-marketer":        0xff40aa,
  "data-analyst":            0xffd050,
  "ai-engineer":             0xffd050,
  "database-administrator":  0xffd050,
  "project-manager":         0x8840ff,
  "multi-agent-coordinator": 0x8840ff,
};

/** Badge colors as CSS hex strings — consumed by React components. */
export const ROLE_BADGE_CSS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_BADGE_COLORS).map(([role, color]) => [role, toHexString(color)])
);

// ---------------------------------------------------------------------------
// Role abbreviations
// ---------------------------------------------------------------------------

/** Short 2–3 letter abbreviations shown inside PixiJS role badges. */
export const ROLE_ABBREVIATIONS: Record<string, string> = {
  "frontend-developer":      "FE",
  "backend-developer":       "BE",
  "mobile-developer":        "MB",
  "mobile-app-developer":    "MA",
  "debugger":                "DB",
  "code-reviewer":           "CR",
  "security-auditor":        "SA",
  "security-engineer":       "SE",
  "ui-designer":             "UI",
  "content-marketer":        "CM",
  "data-analyst":            "DA",
  "ai-engineer":             "AI",
  "database-administrator":  "DBA",
  "project-manager":         "PM",
  "multi-agent-coordinator": "CO",
  "seo-specialist":          "SEO",
  "business-analyst":        "BA",
  "general-purpose":         "GP",
  "Explore":                 "EX",
  "Plan":                    "PL",
};

// ---------------------------------------------------------------------------
// Agent palette colors
// ---------------------------------------------------------------------------

/**
 * CSS hex strings derived from the canonical agentPalettes in palette.ts,
 * using each palette's hair color.  These drive the left-border accent on
 * agent cards in the React status bar.
 */
export const AGENT_PALETTE_COLORS: readonly string[] = PALETTE.agentPalettes.map(
  (p) => toHexString(p.hair)
);
