/**
 * 构建**单个**插件包（包自己的 `build` 脚本调它）：产物写进包自己的 `dist/`。
 *
 *   node scripts/build-plugin.mjs <包目录> [产物目录]
 *
 * 宿主那边的"安装"由 `scripts/build-plugins.mjs` 编排——它用同一个预设，只是把产物写进插件目录。
 */
import path from "node:path";
import { buildPlugin } from "./lib/build-plugin.mjs";

const dir = path.resolve(process.argv[2] ?? ".");
const outDir = path.resolve(process.argv[3] ?? path.join(dir, "dist"));

await buildPlugin(dir, outDir);
console.log(`已产出 ${path.relative(process.cwd(), outDir)}`);
