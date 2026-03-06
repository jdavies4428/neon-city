import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import "./styles/components.css";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
