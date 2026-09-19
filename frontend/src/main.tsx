import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
