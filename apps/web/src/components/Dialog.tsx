import { useEffect, useState } from "react";
import type { DialogAnswer, DialogReq } from "../types";

export interface ExtDialogProps {
  req: DialogReq | null;
  onResolve: (ans: DialogAnswer) => void;
}

export function ExtDialog({ req, onResolve }: ExtDialogProps) {
  const [val, setVal] = useState("");
  // Clear the input whenever a new request arrives so text typed into one
  // `input` dialog doesn't leak into the next one.
  useEffect(() => {
    setVal("");
  }, [req]);
  useEffect(() => {
    if (!req) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve({ cancelled: true });
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [req, onResolve]);
  if (!req) return null;

  return (
    <div className="dialogscrim" data-testid="dialog">
      <div className="dialog" style={{ animation: "fadeup .2s ease both" }}>
        <div className="dialoghdr">
          <span className="extbadge mono">extension_ui_request</span>
          <span className="dialogmethod mono">{req.method}</span>
        </div>
        <div className="dialogtitle">{req.title}</div>
        {req.message && <div className="dialogmsg mono">{req.message}</div>}
        {req.cmd && (
          <div className="dialogcmd mono">
            <span className="cmdprompt">$</span> {req.cmd}
          </div>
        )}

        {req.method === "confirm" && (
          <div className="dialogactions">
            <button
              className="dlgbtn"
              onClick={() => onResolve({ confirmed: false })}
              data-testid="dialog-deny"
            >
              Deny
            </button>
            <button
              className="dlgbtn primary"
              onClick={() => onResolve({ confirmed: true })}
              data-testid="dialog-allow"
            >
              Allow <span className="kbd mono">⏎</span>
            </button>
          </div>
        )}

        {req.method === "select" && (
          <div className="dialogopts">
            {(req.options || []).map((o, i) => (
              <button
                key={i}
                className="dlgopt"
                onClick={() => onResolve({ value: o })}
                data-testid={`dialog-option-${i}`}
              >
                <span className="dlgoptnum mono">{i + 1}</span>
                {o}
              </button>
            ))}
          </div>
        )}

        {req.method === "input" && (
          <div className="dialoginput">
            <input
              className="dlgfield mono"
              autoFocus
              placeholder={req.placeholder || "…"}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onResolve({ value: val });
              }}
              data-testid="dialog-input"
            />
            <button
              className="dlgbtn primary"
              onClick={() => onResolve({ value: val })}
              data-testid="dialog-submit"
            >
              Submit
            </button>
          </div>
        )}

        <button
          className="dialogcancel mono"
          onClick={() => onResolve({ cancelled: true })}
          data-testid="dialog-dismiss"
        >
          dismiss · esc
        </button>
      </div>
    </div>
  );
}
