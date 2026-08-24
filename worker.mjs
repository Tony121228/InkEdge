import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';

globalThis.CLOUDFLARE_ENV = env;
for (const [key, value] of Object.entries(env)) {
  if (typeof value === 'string') process.env[key] = value;
}
const { default: app } = await import('./server.js');

app.listen(3000);

export default httpServerHandler({ port: 3000 });
