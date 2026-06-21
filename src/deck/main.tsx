import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Deck from "./Deck";
import "../index.css";
import "./deck.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Deck />
  </StrictMode>,
);
