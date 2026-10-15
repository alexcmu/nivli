import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
// Personal development credentials stay outside Git. Environment variables override the file.
await mkdir(".secrets", { recursive: true, mode: 0o700 });
for (const file of [".secrets/apns.env", ".secrets/portal-local.env"]) {
  try {
    const content = await readFile(file, "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
if (!process.env.DATABASE_URL)
  throw new Error(
    "请先在 .secrets/portal-local.env 配置 DATABASE_URL（本地 PostgreSQL 地址）。",
  );
if (!process.env.ADMIN_SECRET) {
  process.env.ADMIN_SECRET = randomBytes(32).toString("hex");
  await writeFile(
    ".secrets/portal-local.env",
    `DATABASE_URL=${process.env.DATABASE_URL}\nADMIN_SECRET=${process.env.ADMIN_SECRET}\n`,
    { mode: 0o600, flag: "a" },
  );
}
process.env.HOST ??= "127.0.0.1";
process.env.PORT ??= "4325";
process.env.PUBLIC_URL ??= `https://localhost:${process.env.PORT}`;
process.env.ENVIRONMENT_NAME ??= "Haiji · 本地测试";
console.log(`Portal: http://127.0.0.1:${process.env.PORT}/portal`);
console.log(
  "登录密钥保存在 .secrets/portal-local.env 的 ADMIN_SECRET。不要把它输入 iPhone。",
);
console.log(
  "手机配对需要可从 iPhone 访问的 HTTPS PUBLIC_URL；本地网页地址用于管理。",
);
const child = spawn(process.execPath, ["dist/main.js", "serve"], {
  env: process.env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => (process.exitCode = code ?? 1));
