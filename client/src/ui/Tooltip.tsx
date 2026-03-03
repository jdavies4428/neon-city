interface Props {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  details?: string;
  type?: "building" | "agent" | "district";
}

export function Tooltip({ visible, x, y, title, details, type = "building" }: Props) {
  if (!visible) return null;

  return (
    <div
      className={`city-tooltip ${type}`}
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -100%) translateY(-8px)",
      }}
    >
      <div className="tooltip-title">{title}</div>
      {details && <div className="tooltip-details">{details}</div>}
    </div>
  );
}
