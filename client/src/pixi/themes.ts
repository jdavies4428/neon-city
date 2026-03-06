/**
 * Theme system — data-driven city palettes.
 * Each theme defines colors for sky, buildings, roads, neon, and weather particles.
 */

export interface CityTheme {
  id: string;
  name: string;
  icon: string;

  sky: {
    top: number;
    bottom: number;
    stars: number;
    moon: number;
    moonGlow: number;
  };

  building: {
    dark: number;
    mid: number;
    light: number;
    edge: number;
    windowOff: number;
    windowDim: number;
    windowLit: number;
    windowWarm: number;
  };

  road: {
    dark: number;
    mid: number;
    line: number;
    lineYellow: number;
    sidewalk: number;
  };

  neon: {
    blue: number;
    pink: number;
    green: number;
    yellow: number;
    cyan: number;
    orange: number;
    purple: number;
    red: number;
  };

  glow: {
    read: number;
    write: number;
    search: number;
    bash: number;
  };

  lamp: {
    post: number;
    light: number;
    glow: number;
  };

  district: {
    social: { primary: number; secondary: number; sign: string };
    library: { primary: number; secondary: number; sign: string };
    workshop: { primary: number; secondary: number; sign: string };
    terminal: { primary: number; secondary: number; sign: string };
    qc: { primary: number; secondary: number; sign: string };
    studio: { primary: number; secondary: number; sign: string };
    hq: { primary: number; secondary: number; sign: string };
  };

  background: number;
}

/** Default neon city theme */
export const THEME_CITY: CityTheme = {
  id: "city",
  name: "Neon City",
  icon: "🏙️",

  sky: {
    top: 0x05050f,
    bottom: 0x0a0a2a,
    stars: 0xffffff,
    moon: 0xffffdd,
    moonGlow: 0x4444aa,
  },

  building: {
    dark: 0x0c0c1e,
    mid: 0x141432,
    light: 0x1c1c44,
    edge: 0x222255,
    windowOff: 0x0a0a18,
    windowDim: 0x1a1a40,
    windowLit: 0x334488,
    windowWarm: 0x554422,
  },

  road: {
    dark: 0x0a0a14,
    mid: 0x111122,
    line: 0x333355,
    lineYellow: 0x888844,
    sidewalk: 0x181830,
  },

  neon: {
    blue: 0x4080ff,
    pink: 0xff40aa,
    green: 0x40ff80,
    yellow: 0xffd050,
    cyan: 0x40ddff,
    orange: 0xff8840,
    purple: 0x8840ff,
    red: 0xff4040,
  },

  glow: {
    read: 0xffd050,
    write: 0x88d870,
    search: 0x40ddff,
    bash: 0xff8840,
  },

  lamp: {
    post: 0x333355,
    light: 0xffdd88,
    glow: 0x554422,
  },

  district: {
    social:   { primary: 0xffaa44, secondary: 0xffcc88, sign: "CHILL ZONE" },
    library:  { primary: 0xffd050, secondary: 0xffe080, sign: "LIBRARY" },
    workshop: { primary: 0x40ff80, secondary: 0x80ffaa, sign: "WORKSHOP" },
    terminal: { primary: 0xff8840, secondary: 0xffaa66, sign: "TERMINAL" },
    qc:       { primary: 0x40ddff, secondary: 0x80eeff, sign: "QC LAB" },
    studio:   { primary: 0xff40aa, secondary: 0xff80cc, sign: "STUDIO" },
    hq:       { primary: 0x8840ff, secondary: 0xaa80ff, sign: "HQ" },
  },

  background: 0x05050f,
};

/** Beach / tropical theme */
export const THEME_BEACH: CityTheme = {
  id: "beach",
  name: "Sunset Beach",
  icon: "🏖️",

  sky: {
    top: 0x0a1025,
    bottom: 0x1a2040,
    stars: 0xffeedd,
    moon: 0xffeecc,
    moonGlow: 0x664422,
  },

  building: {
    dark: 0x1a1410,
    mid: 0x2a2418,
    light: 0x3a3428,
    edge: 0x4a4438,
    windowOff: 0x181410,
    windowDim: 0x2a2418,
    windowLit: 0x886644,
    windowWarm: 0x664422,
  },

  road: {
    dark: 0x1a1810,
    mid: 0x2a2818,
    line: 0x554830,
    lineYellow: 0xaa8844,
    sidewalk: 0x2a2618,
  },

  neon: {
    blue: 0x44aaff,
    pink: 0xff6688,
    green: 0x66dd88,
    yellow: 0xffcc44,
    cyan: 0x44ddcc,
    orange: 0xff8844,
    purple: 0xaa66cc,
    red: 0xff5544,
  },

  glow: {
    read: 0xffcc44,
    write: 0x66dd88,
    search: 0x44ddcc,
    bash: 0xff8844,
  },

  lamp: {
    post: 0x554830,
    light: 0xffcc66,
    glow: 0x665522,
  },

  district: {
    social:   { primary: 0xffcc44, secondary: 0xffdd66, sign: "TIKI BAR" },
    library:  { primary: 0x66dd88, secondary: 0x88ffaa, sign: "LIGHTHOUSE" },
    workshop: { primary: 0x44ddcc, secondary: 0x66ffee, sign: "BOAT HOUSE" },
    terminal: { primary: 0xff8844, secondary: 0xffaa66, sign: "DOCK" },
    qc:       { primary: 0x44aaff, secondary: 0x66ccff, sign: "TIDE POOL" },
    studio:   { primary: 0xff6688, secondary: 0xff88aa, sign: "SURF SHACK" },
    hq:       { primary: 0xaa66cc, secondary: 0xcc88ee, sign: "CAPTAIN'S" },
  },

  background: 0x0a1025,
};

/** Space station theme */
export const THEME_SPACE: CityTheme = {
  id: "space",
  name: "Space Station",
  icon: "🚀",

  sky: {
    top: 0x020208,
    bottom: 0x060612,
    stars: 0xffffff,
    moon: 0xbbccee,
    moonGlow: 0x223355,
  },

  building: {
    dark: 0x0a0c14,
    mid: 0x10141e,
    light: 0x181c28,
    edge: 0x202838,
    windowOff: 0x080a10,
    windowDim: 0x182030,
    windowLit: 0x2a4466,
    windowWarm: 0x443322,
  },

  road: {
    dark: 0x080a10,
    mid: 0x0e1018,
    line: 0x283040,
    lineYellow: 0x446688,
    sidewalk: 0x101420,
  },

  neon: {
    blue: 0x3366ff,
    pink: 0xee44aa,
    green: 0x33ee77,
    yellow: 0xddcc44,
    cyan: 0x33ccee,
    orange: 0xee7733,
    purple: 0x7733ee,
    red: 0xee3333,
  },

  glow: {
    read: 0xddcc44,
    write: 0x33ee77,
    search: 0x33ccee,
    bash: 0xee7733,
  },

  lamp: {
    post: 0x283040,
    light: 0xccddff,
    glow: 0x334466,
  },

  district: {
    social:   { primary: 0xddcc44, secondary: 0xeedd66, sign: "MESS HALL" },
    library:  { primary: 0x33ee77, secondary: 0x66ff99, sign: "CORE SYS" },
    workshop: { primary: 0x33ccee, secondary: 0x66ddff, sign: "ENGINEERING" },
    terminal: { primary: 0xee7733, secondary: 0xff9955, sign: "BRIDGE" },
    qc:       { primary: 0x3366ff, secondary: 0x5588ff, sign: "DIAGNOSTICS" },
    studio:   { primary: 0xee44aa, secondary: 0xff66cc, sign: "MODULE A" },
    hq:       { primary: 0x7733ee, secondary: 0x9966ff, sign: "COMMAND" },
  },

  background: 0x020208,
};

/** Dawn / light-warm theme */
export const THEME_DAWN: CityTheme = {
  id: "dawn",
  name: "City Dawn",
  icon: "🌅",

  sky: {
    top: 0x4a90d9,
    bottom: 0xffeedd,
    stars: 0xffffff,
    moon: 0xfff8e0,
    moonGlow: 0xfff0c0,
  },

  building: {
    dark: 0x8090a0,
    mid: 0xa0b0c0,
    light: 0xc0d0e0,
    edge: 0x90a0b0,
    windowOff: 0xb0c0d0,
    windowDim: 0xc8d8e8,
    windowLit: 0x40a0ff,
    windowWarm: 0xffd080,
  },

  road: {
    dark: 0x707880,
    mid: 0x909aa0,
    line: 0xffffff,
    lineYellow: 0xffcc00,
    sidewalk: 0xc0c8d0,
  },

  neon: {
    blue: 0x2070dd,
    pink: 0xdd3090,
    green: 0x20aa50,
    yellow: 0xddaa00,
    cyan: 0x2099bb,
    orange: 0xdd6620,
    purple: 0x7030cc,
    red: 0xdd2020,
  },

  glow: {
    read: 0xddaa00,
    write: 0x20aa50,
    search: 0x2070dd,
    bash: 0xdd6620,
  },

  lamp: {
    post: 0x606870,
    light: 0xfff0d0,
    glow: 0xffeebb,
  },

  district: {
    social:   { primary: 0xdd3090, secondary: 0xffccee, sign: "CAFE" },
    library:  { primary: 0xddaa00, secondary: 0xfff0cc, sign: "LIBRARY" },
    workshop: { primary: 0x20aa50, secondary: 0xccffdd, sign: "WORKSHOP" },
    terminal: { primary: 0xdd6620, secondary: 0xffdcc0, sign: "TERMINAL" },
    qc:       { primary: 0x2099bb, secondary: 0xccf0ff, sign: "QC LAB" },
    studio:   { primary: 0xdd3090, secondary: 0xffccee, sign: "STUDIO" },
    hq:       { primary: 0x7030cc, secondary: 0xe0ccff, sign: "HQ" },
  },

  background: 0xe8eef4,
};

/** All available themes */
export const ALL_THEMES: CityTheme[] = [THEME_CITY, THEME_BEACH, THEME_SPACE, THEME_DAWN];

/** Get theme by ID */
export function getTheme(id: string): CityTheme {
  return ALL_THEMES.find((t) => t.id === id) ?? THEME_CITY;
}
