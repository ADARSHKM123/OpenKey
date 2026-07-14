import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled, not fetched — nothing in this product may call out to a
// domain the customer didn't configure, including Google Fonts.
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./index.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
