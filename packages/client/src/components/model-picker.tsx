import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
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
    <Select
      value={selected ? modelKey(selected) : ""}
      onValueChange={(v) => {
        const m = models.find((x) => modelKey(x) === v);
        if (m) select(m);
      }}
    >
      <SelectTrigger data-testid="model-picker" size="sm" className="w-[200px] text-xs">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={modelKey(m)} value={modelKey(m)} data-testid={`model-option-${modelKey(m)}`}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
