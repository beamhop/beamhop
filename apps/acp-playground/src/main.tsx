import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// We intentionally don't wrap in <StrictMode>. The app's lifecycle is anchored
// to a single long-lived WebSocket session; StrictMode's double-invoke causes
// transient duplicate connections that race with React state updates and
// produce flaky behavior (see the slash-commands e2e flake trace). The SDK
// itself is tested under stricter conditions in its own unit suite.
createRoot(root).render(<App />);
