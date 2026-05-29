import type { Toast } from "../hooks/useToast";

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toaststack" data-testid="toaststack">
      {toasts.map((t) => (
        <div className={"toast " + (t.tone || "")} key={t.id}>
          <span className="toastglyph">{t.glyph || "✓"}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
