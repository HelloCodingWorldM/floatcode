const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "floatcode-smoke-"));
const child = spawn(require("electron"), [path.join(__dirname, "..", "tests", "desktop-smoke.cjs")], {
  stdio: "inherit",
  env: { ...process.env, FLOATCODE_TEST_USER_DATA: userData },
});
const timer = setTimeout(() => {
  console.error("Desktop smoke test exceeded 75 seconds");
  child.kill();
}, 75000);
child.on("error", (error) => { console.error(error); clearTimeout(timer); process.exitCode = 1; });
child.on("exit", (code) => {
  clearTimeout(timer);
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
  process.exitCode = code ?? 1;
});
