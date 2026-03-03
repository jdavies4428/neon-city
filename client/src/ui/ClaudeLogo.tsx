interface Props {
  size?: number;
  thinking?: boolean;
  className?: string;
}

/**
 * Claude starburst logo — 6-petal asterisk mark in Anthropic orange.
 * When `thinking` is true, the logo pulses with a glow animation.
 */
export function ClaudeLogo({ size = 24, thinking = false, className = "" }: Props) {
  const classes = [
    "claude-starburst",
    thinking ? "thinking" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
    >
      <g transform="translate(12,12)" fill="#D97757">
        {/* 6 petals rotated 60° apart */}
        <path d="M0,-10 C2.2,-7 2.2,-2.5 0,0 C-2.2,-2.5 -2.2,-7 0,-10Z" />
        <path d="M0,-10 C2.2,-7 2.2,-2.5 0,0 C-2.2,-2.5 -2.2,-7 0,-10Z" transform="rotate(60)" />
        <path d="M0,-10 C2.2,-7 2.2,-2.5 0,0 C-2.2,-2.5 -2.2,-7 0,-10Z" transform="rotate(120)" />
        <path d="M0,-10 C2.2,-7 2.2,-2.5 0,0 C-2.2,-2.5 -2.2,-7 0,-10Z" transform="rotate(180)" />
        <path d="M0,-10 C2.2,-7 2.2,-2.5 0,0 C-2.2,-2.5 -2.2,-7 0,-10Z" transform="rotate(240)" />
        <path d="M0,-10 C2.2,-7 2.2,-2.5 0,0 C-2.2,-2.5 -2.2,-7 0,-10Z" transform="rotate(300)" />
      </g>
    </svg>
  );
}
