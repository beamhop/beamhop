/* ============================================================
   dialog.jsx — extension UI request overlay (confirm / select / input)
   ============================================================ */
const { useState: duseState, useEffect: duseEffect } = React;

function ExtDialog({ req, onResolve }) {
  const [val, setVal] = duseState("");
  duseEffect(() => {
    const k = (e) => { if (e.key === "Escape") onResolve({ cancelled: true }); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [req]);
  if (!req) return null;

  return (
    <div className="dialogscrim">
      <div className="dialog" style={{ animation: "fadeup .2s ease both" }}>
        <div className="dialoghdr">
          <span className="extbadge mono">extension_ui_request</span>
          <span className="dialogmethod mono">{req.method}</span>
        </div>
        <div className="dialogtitle">{req.title}</div>
        {req.message && <div className="dialogmsg mono">{req.message}</div>}
        {req.cmd && <div className="dialogcmd mono"><span className="cmdprompt">$</span> {req.cmd}</div>}

        {req.method === "confirm" && (
          <div className="dialogactions">
            <button className="dlgbtn" onClick={() => onResolve({ confirmed: false })}>Deny</button>
            <button className="dlgbtn primary" onClick={() => onResolve({ confirmed: true })}>
              Allow <span className="kbd mono">⏎</span>
            </button>
          </div>
        )}

        {req.method === "select" && (
          <div className="dialogopts">
            {(req.options || []).map((o, i) => (
              <button key={i} className="dlgopt" onClick={() => onResolve({ value: o })}>
                <span className="dlgoptnum mono">{i + 1}</span>{o}
              </button>
            ))}
          </div>
        )}

        {req.method === "input" && (
          <div className="dialoginput">
            <input className="dlgfield mono" autoFocus placeholder={req.placeholder || "…"}
              value={val} onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onResolve({ value: val }); }} />
            <button className="dlgbtn primary" onClick={() => onResolve({ value: val })}>Submit</button>
          </div>
        )}

        <button className="dialogcancel mono" onClick={() => onResolve({ cancelled: true })}>dismiss · esc</button>
      </div>
    </div>
  );
}

window.ExtDialog = ExtDialog;
