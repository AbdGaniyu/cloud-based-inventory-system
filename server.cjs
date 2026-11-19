/**
 * Startup file for hosts that run a Node.js file instead of `pnpm start`, such as cPanel's
 * "Setup Node.js App" (Phusion Passenger) or a plain `node server.cjs` under systemd/PM2.
 * Build first (`pnpm build`); environment comes from the host or the .env file in this folder.
 */
const { createServer } = require("node:http");
const next = require("next");

const port = Number(process.env.PORT || 3000);
// Not HOSTNAME: many systems set that to the machine name, which would bind the wrong interface.
const hostname = process.env.LISTEN_HOST || "0.0.0.0";
const app = next({ dev: false, dir: __dirname, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
      console.info(`LeePlugsHub ready on http://${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
