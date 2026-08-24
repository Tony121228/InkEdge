const http = require('http');
const assert = require('assert');

function listen(app){
  return new Promise((resolve)=>{ const srv = app.listen(0,'127.0.0.1',()=> resolve(srv)); });
}
function req(base, method, path, body){
  return new Promise((resolve, reject)=>{
    const url = new URL(path, base);
    const payload = body ? JSON.stringify(body) : '';
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname+url.search, headers: { 'content-type': 'application/json' }};
    const r = http.request(opts, (res)=>{ let t=''; res.setEncoding('utf8'); res.on('data',c=>t+=c); res.on('end',()=>{
      try{ resolve({ status: res.statusCode, json: t?JSON.parse(t):null }); } catch(e){ reject(e); }
    }); });
    r.on('error', reject); if(payload) r.end(payload); else r.end();
  });
}

(async () => {
  process.env.APP_DATA_DIR = require('os').tmpdir();
  const app = require('../server');
  const srv = await listen(app);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const create = await req(base, 'POST', '/api/v1/training-plans', { planType: '7d', dailyMinutes: 20, focusDimensions: ['素材具体度','语言自然度'] });
    assert.strictEqual(create.status, 200, 'plan create status');
    const plan = create.json.data; assert.ok(plan && plan.days && plan.days.length===7, '7 days present');
    const active = await req(base, 'GET', '/api/v1/training-plans/active');
    assert.strictEqual(active.status, 200, 'active plan status');
    const a = active.json.data; assert.ok(a && a.id===plan.id && Array.isArray(a.days), 'active plan matches');
    console.log('OK training plan 7d, days=', plan.days.length);
  } finally { srv.close(); }
})();