import { createContext, useContext, type ReactNode } from "react";
import type { AcpSession } from "@beamhop/acp-client";

const AcpSessionContext = createContext<AcpSession | null>(null);

export interface AcpProviderProps {
  session: AcpSession;
  children: ReactNode;
}

export function AcpProvider({ session, children }: AcpProviderProps) {
  return <AcpSessionContext.Provider value={session}>{children}</AcpSessionContext.Provider>;
}

export function useAcp(): AcpSession {
  const ctx = useContext(AcpSessionContext);
  if (!ctx) {
    throw new Error("useAcp must be used inside <AcpProvider session={...}>.");
  }
  return ctx;
}
