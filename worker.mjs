import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import http from 'node:http';

for (const [k, v] of Object.entries(env)) {
  if (typeof v === 'string') process.env[k] = v;
}
globalThis.CLOUDFLARE_ENV = env;

const mod = await import('./server.js');
const app = mod.default || mod;

http.createServer(app).listen(3000);

export default httpServerHandler({ port: 3000 });
