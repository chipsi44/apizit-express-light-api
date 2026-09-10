const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const contract = require('../contract.json');
const { createApp } = require('../src/app.cjs');
let app, client;
const sleeps = [];

before(async () => {
  app = await createApp({
    sleep: async (duration) => {
      sleeps.push(duration);
    },
  });
  client = request(false ? app.getHttpServer() : app);
});
after(async () => {
  if (false) await app.close();
});
test('health and info', async () => {
  const health = await client.get('/health').expect(200);
  assert.deepEqual(health.body, { status: 'ok' });
  assert.deepEqual((await client.get('/info')).body, {
    framework: contract.framework,
    profile: contract.profile,
  });
  assert.deepEqual(sleeps, []);
});
test('echo success preserves fields', async () => {
  const payload = { message: 'hello', count: 2 };
  assert.deepEqual((await client.post('/echo').send(payload).expect(200)).body, {
    received: payload,
  });
});
test('echo validation', async () => {
  for (const payload of [
    null,
    [],
    {},
    { message: '', count: 1 },
    { message: 'x', count: true },
    { message: 'x', count: 1.5 },
    { message: 'x'.repeat(5001), count: 1 },
  ]) {
    await client
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(400);
  }
  await client.post('/echo').set('Content-Type', 'application/json').send('{').expect(400);
});
test('item contract and validation', async () => {
  assert.deepEqual((await client.get('/items/7').expect(200)).body, {
    item_id: 7,
    include_details: false,
  });
  assert.deepEqual((await client.get('/items/7?include_details=true').expect(200)).body, {
    item_id: 7,
    include_details: true,
    details: 'Reference item 7',
  });
  for (const path of [
    '/items/0',
    '/items/-1',
    '/items/abc',
    '/items/9007199254740992',
    '/items/7?include_details=maybe',
  ])
    await client.get(path).expect(400);
});
test('slow waits exactly 80 seconds through a controlled timer', async () => {
  assert.deepEqual((await client.get('/slow').expect(200)).body, {
    delay_seconds: 80,
    status: 'completed',
  });
  assert.deepEqual(sleeps, [80000]);
});
test('route contract has no accidental documentation or admin endpoints', async () => {
  const instance = false ? app.getHttpAdapter().getInstance() : app;
  const routes = instance.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => ({
          method: method.toUpperCase(),
          path: layer.route.path.replace(':item_id', '{item_id}'),
        })),
    );
  assert.deepEqual(
    routes.sort((a, b) => a.path.localeCompare(b.path)),
    [...contract.routes].sort((a, b) => a.path.localeCompare(b.path)),
  );
  await client.get('/docs').expect(404);
});
