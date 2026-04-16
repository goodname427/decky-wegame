interface ProgressBarProps {
  percent: number;
  label?: string;
  showPercent?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function ProgressBar({ percent, label, showPercent = true, size = "md" }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  const heightMap = { sm: "h-1.5", md: "h-2.5", lg: "h-4" };

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-gray-400">{label}</span>
          {showPercent && (
            <span className="font-mono font-medium text-primary">
              {clamped.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div
        className={`w-full overflow-hidden rounded-full bg-white/5 ${heightMap[size]}`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500 ease-out ${
            clamped > 90 ? "animate-pulse" : ""
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
