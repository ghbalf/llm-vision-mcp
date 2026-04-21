import { copyFileSync } from "node:fs";

copyFileSync("src/presets.json", "dist/presets.json");
