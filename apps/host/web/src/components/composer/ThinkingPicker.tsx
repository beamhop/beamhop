import { THINKING_LEVELS, type ThinkingLevel } from "../../data/models";
import { Popover } from "./Popover";

/** Stepped thinking-level selector shown from the composer chip. */
export function ThinkingPicker({
  current,
  onPick,
  onClose,
}: {
  current: ThinkingLevel;
  onPick: (lv: ThinkingLevel) => void;
  onClose: () => void;
}) {
  return (
    <Popover onClose={onClose}>
      <div className="pop-title eyebrow">Thinking level</div>
      <div className="thinkscale">
        {THINKING_LEVELS.map((lv) => (
          <button
            key={lv}
            className={"thinkstep" + (lv === current ? " on" : "")}
            onClick={() => {
              onPick(lv);
              onClose();
            }}
            data-testid={`think-step-${lv}`}
          >
            <span
              className="thinkbar"
              style={{
                height: 6 + THINKING_LEVELS.indexOf(lv) * 4,
                background: lv === current ? "var(--violet)" : "var(--line-strong)",
              }}
            />
            <span className="thinklv mono">{lv}</span>
          </button>
        ))}
      </div>
      <div className="pop-foot mono">xhigh · codex-max only</div>
    </Popover>
  );
}
