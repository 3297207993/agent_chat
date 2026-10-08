/**
 * 把插件目录里的所有插件包**安装**进应用：扫描 → 逐个构建 → 产出目录清单。
 *
 * 产物落在 `public/plugins/<name>/`（dev 由 Vite 静态服务，app build 时原样拷进 dist），形态与
 * "外部装进来的插件包"完全一致——宿主那条装载路径不区分两者。
 *
 * 扫描对象是 `plugins/<name>/cambia.json`：**宿主这边没有编译期的插件表**，装载什么由插件目录
 * 说了算（`src/plugin/host.ts` 读这里产出的清单）。
 */
import { existsSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPlugin } from "./lib/build-plugin.mjs";

const root = path.resolve(import.meta.dirname, "..");
const pluginsDir = path.join(root, "plugins");
const outRoot = path.join(root, "public", "plugins");

async function main() {
  const names = await scan();
  if (names.length === 0) throw new Error(`没有扫描到任何插件：${pluginsDir}`);

  await rm(outRoot, { recursive: true, force: true });

  for (const name of names) {
    await buildPlugin(path.join(pluginsDir, name), path.join(outRoot, name));
  }

  await writeFile(
    path.join(outRoot, "index.json"),
    `${JSON.stringify({ plugins: names }, null, 2)}\n`,
  );

  console.log(`\n插件已安装：${names.length} 个 → public/plugins/`);
  for (const name of names) console.log(`  - ${name}`);
}

/** 扫插件目录下每个含 cambia.json 的包。 */
async function scan() {
  if (!existsSync(pluginsDir)) return [];
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(path.join(pluginsDir, entry.name, "cambia.json"))) continue;
    names.push(entry.name);
  }
  return names.sort();
}

await main();
