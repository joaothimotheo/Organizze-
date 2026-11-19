import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./estilo.css";
import { registrarPwa } from "./pwa";

registrarPwa();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
