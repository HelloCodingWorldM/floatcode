const { spawn } = require("node:child_process");
const child = spawn(require("electron"), ["."], {
  stdio: "inherit",
  env: { ...process.env, FLOATCODE_DEV: "1" },
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
