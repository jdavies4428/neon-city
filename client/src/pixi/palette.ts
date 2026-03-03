/** Neon City color palette — all colors for the pixel art city */

export const PALETTE = {
  // Sky
  skyTop: 0x05050f,
  skyBottom: 0x0a0a2a,
  stars: 0xffffff,
  moon: 0xffffdd,
  moonGlow: 0x4444aa,

  // Buildings
  buildingDark: 0x0c0c1e,
  buildingMid: 0x141432,
  buildingLight: 0x1c1c44,
  buildingEdge: 0x222255,
  windowOff: 0x0a0a18,
  windowDim: 0x1a1a40,
  windowLit: 0x334488,
  windowWarm: 0x554422,

  // Neon colors (for signs, glows)
  neonBlue: 0x4080ff,
  neonPink: 0xff40aa,
  neonGreen: 0x40ff80,
  neonYellow: 0xffd050,
  neonCyan: 0x40ddff,
  neonOrange: 0xff8840,
  neonPurple: 0x8840ff,
  neonRed: 0xff4040,

  // Activity glows
  glowRead: 0xffd050,
  glowWrite: 0x88d870,
  glowSearch: 0x40ddff,
  glowBash: 0xff8840,

  // Road / ground
  roadDark: 0x0a0a14,
  roadMid: 0x111122,
  roadLine: 0x333355,
  roadLineYellow: 0x888844,
  sidewalk: 0x181830,

  // Streetlamp
  lampPost: 0x333355,
  lampLight: 0xffdd88,
  lampGlow: 0x554422,

  // Agent colors (5 unique palettes)
  agentPalettes: [
    { hair: 0x4466aa, shirt: 0x3366cc, pants: 0x222244 }, // Blue
    { hair: 0xcc4444, shirt: 0xdd5555, pants: 0x332222 }, // Red
    { hair: 0x44aa66, shirt: 0x55cc77, pants: 0x223322 }, // Green
    { hair: 0xcc8844, shirt: 0xddaa55, pants: 0x332211 }, // Orange
    { hair: 0x8844cc, shirt: 0xaa55dd, pants: 0x221133 }, // Purple
  ],

  // UI
  textPrimary: 0xffffff,
  textDim: 0x888888,
  bgPanel: 0x0a0a1a,
} as const;

/** District theme colors */
export const DISTRICT_THEMES = {
  creative: { primary: 0xff40aa, secondary: 0xff80cc, sign: "CREATIVE" },
  data: { primary: 0x40ff80, secondary: 0x80ffaa, sign: "DATA TOWER" },
  qc: { primary: 0x40ddff, secondary: 0x80eeff, sign: "QC LAB" },
  workshop: { primary: 0xffd050, secondary: 0xffe080, sign: "WORKSHOP" },
  arts: { primary: 0x8840ff, secondary: 0xaa80ff, sign: "ARTS" },
} as const;

export type DistrictType = keyof typeof DISTRICT_THEMES;
