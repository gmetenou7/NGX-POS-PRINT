// Teste le service compile (dist/) : lancer `npm run build` avant `npm test`.
import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { BridgePrintService, POS_PRINT_CONFIG } from '../dist/fesm2022/ngx-pos-print.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let agent; const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); calls.push({ path: u.pathname, method: init.method ?? 'GET', headers: init.headers ?? {} });
  if (u.port !== '19101') throw new TypeError('fetch failed');
  return agent(u.pathname, init);
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (cfg = {}) => { const inj = Injector.create({ providers: [{ provide: POS_PRINT_CONFIG, useValue: cfg }] }); return runInInjectionContext(inj, () => new BridgePrintService()); };
const TOKEN = 'x'.repeat(40);
const paired = new Set();
let s, r;

test("1. Agent ancien : pas d'en-tete de jeton, statut legacy.", async () => {
  agent = (p) => p === '/health' ? json(200, { ok: true }) : p === '/print' ? json(200, { ok: true }) : json(200, { printers: [] });
  s = make({ bridgeToken: TOKEN });
  assert.equal((await s.print(new Uint8Array([1]))).success, true);
  assert.equal(calls.at(-1).headers['X-Print-Bridge-Token'], undefined);
  assert.equal(await s.pairingStatus(), 'legacy');
});

test('2. Agent recent, jeton inconnu : pairing_required type, puis association, puis impression.', async () => {
  paired.clear();
  agent = (p, init) => {
    const tok = (init.headers ?? {})['X-Print-Bridge-Token'];
    if (p === '/health') return json(200, { ok: true, pairingRequired: true, ...(tok ? { paired: paired.has(tok) } : {}) });
    if (p === '/pair' && init.method === 'POST') { paired.add(JSON.parse(init.body).token); return json(200, { ok: true, paired: true }); }
    if (p === '/pair' && init.method === 'DELETE') { paired.delete(tok); return json(200, { ok: true }); }
    if (!paired.has(tok)) return json(401, { ok: false, error: 'pairing_required' });
    return p === '/printers' ? json(200, { printers: [{ id: 'a', isThermal: true }] }) : json(200, { ok: true, pages: 1 });
  };
  calls.length = 0; s = make({ bridgeToken: TOKEN });
  r = await s.print(new Uint8Array([1]));
  assert.equal(r.errorCode, 'pairing_required');
  assert.equal(calls.at(-1).headers['X-Print-Bridge-Token'], TOKEN);
  assert.deepEqual(await s.listPrinters(), []); assert.equal(s.lastError, 'pairing_required');
  assert.equal(await s.pairingStatus(), 'unpaired');
  assert.equal((await s.pairBridge()).success, true);
  assert.equal(await s.pairingStatus(), 'paired');
  assert.equal((await s.listPrinters()).length, 1); assert.equal(s.lastError, null);
  assert.equal((await s.printDocument(['aGk='])).success, true);
  assert.equal((await s.unpairBridge()).success, true);
  assert.equal((await s.printDocument(['aGk='])).errorCode, 'pairing_required');
});

test('3. setBridgeToken / getBridgeToken.', async () => {
  s.setBridgeToken(null); assert.equal(s.getBridgeToken(), null); assert.equal(await s.pairingStatus(), 'unpaired');
});

test('4. Agent absent : agent_unreachable, distinct.', async () => {
  agent = () => { throw new TypeError('down'); };
  s = make({ bridgeToken: TOKEN });
  assert.equal((await s.print(new Uint8Array([1]))).errorCode, 'agent_unreachable');
  assert.equal(await s.pairingStatus(), 'absent');
  assert.equal((await s.pairBridge()).errorCode, 'agent_unreachable');
});
