export function AuroraBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-night-900">
      <div className="absolute inset-0 bg-aurora-mesh" />
      <div className="absolute top-1/4 left-1/3 h-96 w-96 rounded-full bg-signal-500/10 blur-[120px] animate-float" />
      <div
        className="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-beacon-500/10 blur-[120px] animate-float"
        style={{ animationDelay: "2s" }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}
