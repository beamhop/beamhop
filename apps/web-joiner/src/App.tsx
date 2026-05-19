import { useEffect, useState } from "react";
import { decode } from "@beamhop/invite-link";
import type { Invite } from "@beamhop/invite-link";
import { AgentScreen } from "./components/AgentScreen.tsx";
import { LandingScreen } from "./components/LandingScreen.tsx";
import { TerminalScreen } from "./components/TerminalScreen.tsx";
import { ErrorScreen } from "./components/ErrorScreen.tsx";

type Phase =
  | { kind: "no-link" }
  | { kind: "decode-error"; error: string }
  | { kind: "ready"; invite: Invite };

function readPhase(): Phase {
  const hash = window.location.hash;
  if (!hash || hash === "#") return { kind: "no-link" };
  const result = decode(hash);
  if (!result.ok) return { kind: "decode-error", error: result.error };
  return { kind: "ready", invite: result.invite };
}

export function App() {
  const [phase, setPhase] = useState<Phase>(() => readPhase());

  useEffect(() => {
    const onHashChange = () => setPhase(readPhase());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (phase.kind === "no-link") return <LandingScreen />;
  if (phase.kind === "decode-error")
    return <ErrorScreen title="Invalid invite" detail={phase.error} />;
  if (phase.kind === "ready" && phase.invite.kind === "terminal")
    return <TerminalScreen invite={phase.invite} />;
  if (phase.kind === "ready" && phase.invite.kind === "agent")
    return <AgentScreen invite={phase.invite} />;
  return <ErrorScreen title="Unknown invite kind" />;
}
