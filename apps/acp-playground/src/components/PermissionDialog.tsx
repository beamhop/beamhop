import { ShieldAlert } from "lucide-react";
import type { PendingPrompt } from "@beamhop/acp-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog.js";
import { Button } from "./ui/button.js";

export function PermissionDialog({
  pending,
  respond,
}: {
  pending: PendingPrompt | null;
  respond: (d: "allow_once" | "allow_always" | "reject_once" | "reject_always") => void;
}) {
  const open = pending !== null;
  const request = pending?.payload.request as
    | {
        toolCall?: { name?: string; title?: string };
        options?: Array<{ optionId: string; kind?: string; name?: string }>;
      }
    | undefined;
  const tool = request?.toolCall?.title ?? request?.toolCall?.name ?? "an operation";

  return (
    <Dialog open={open}>
      <DialogContent>
        <div className="p-5">
          <div className="flex items-baseline gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-amber translate-y-0.5" />
            <DialogTitle>permission required</DialogTitle>
          </div>
          <DialogDescription className="mt-4">
            the agent wants to perform{" "}
            <span className="text-paper">{tool}</span>. approve once for this turn,
            always for this session, or reject.
          </DialogDescription>

          <pre className="mt-4 px-3 py-2 bg-ink-2 border border-rule-soft text-[11px] text-bone overflow-x-auto leading-relaxed">
            {pretty(request)}
          </pre>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => respond("reject_once")}>
              reject
            </Button>
            <Button variant="outline" size="sm" onClick={() => respond("allow_always")}>
              allow always
            </Button>
            <Button variant="primary" size="sm" onClick={() => respond("allow_once")}>
              allow once
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
