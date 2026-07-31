import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/global.css";

/** Follows the system appearance. The tokens do the rest. */
function applyTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
applyTheme(media.matches);
media.addEventListener("change", (e) => applyTheme(e.matches));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
