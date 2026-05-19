import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("root element not found");
// No StrictMode — xterm's Viewport doesn't survive double-mount in dev, and
// double-dialing a trystero room would waste signaling round-trips.
createRoot(container).render(<App />);
