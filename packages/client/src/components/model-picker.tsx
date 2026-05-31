import { modelKey, useSelectedModel } from "@/lib/model-context.tsx";

/** Header dropdown to choose which model prompts are sent with. */
export function ModelPicker() {
  const { models, selected, select } = useSelectedModel();

  if (models.length === 0) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="model-picker-empty">
        no models
      </span>
    );
  }

  return (
    <select
      data-testid="model-picker"
      value={selected ? modelKey(selected) : ""}
      onChange={(e) => {
        const m = models.find((x) => modelKey(x) === e.target.value);
        if (m) select(m);
      }}
      className="h-8 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {models.map((m) => (
        <option key={modelKey(m)} value={modelKey(m)} data-testid={`model-option-${modelKey(m)}`}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
