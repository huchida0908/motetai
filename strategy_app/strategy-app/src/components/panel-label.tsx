// パネル見出し（ピットウォール風の小さなラベル）。
// 赤のティックマーク＋トラッキング広めの小文字ラベルで各パネルの階層を示す。
export function PanelLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] tracking-[0.18em] text-muted-foreground uppercase ${className}`}>
      <span className="inline-block h-2.5 w-[3px] bg-primary/80" />
      {children}
    </div>
  );
}
