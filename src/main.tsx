import { render } from "preact";

import { InstrumentApp } from "./ui/instrument-app.js";
import "./ui/global.css";

const root = document.getElementById("app");
if (root === null) throw new Error("The application root is missing.");

render(<InstrumentApp />, root);
