process.env.HOST ||= "0.0.0.0";
process.env.PORT ||= "1234";
const path = require("node:path");
require(path.join(path.dirname(require.resolve("y-websocket/package.json")), "bin", "server.cjs"));
