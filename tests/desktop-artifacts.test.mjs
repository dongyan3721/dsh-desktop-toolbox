import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgentArtifact } from '../packages/dsh-toolbox/src/desktop/artifacts.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF4kAAAAASUVORK5CYII=', 'base64');
const descriptor = { artifact_id: 'a'.repeat(32), module_id: 'screen_ink', revision: 7, mime_type: 'image/png', byte_length: png.length, width: 1, height: 1 };
function fixture(mutate = value => value) {
  const calls = [];
  let granted = true;
  const desktop = {
    async getAgentAccess() { return { revision: 7, modules: [{ id: 'screen_ink', agent_supported: true, agent_allowed: granted, agent_effective: granted }] }; },
    async agentCall(method, params) {
      calls.push({ method, params });
      if (!granted) throw Object.assign(new Error('revoked'), { code: 'AGENT_ACCESS_DENIED' });
      const bytes = png.subarray(params.offset, params.offset + params.length);
      return mutate({ ...descriptor, offset: params.offset, total_bytes: png.length, data_base64: bytes.toString('base64'), eof: params.offset + bytes.length === png.length }, () => granted = false);
    },
  };
  return { desktop, calls };
}

test('real PNG bytes come only through a bounded native artifact ID request', async () => {
  const f = fixture();
  const image = await readAgentArtifact(f.desktop, { ...descriptor, relative_path: 'C:/private/ignored.png' });
  assert.deepEqual(image.data, png);
  assert.equal(image.mediaType, 'image/png');
  assert.deepEqual(f.calls, [{ method: 'agent.artifacts.read', params: { artifact_id: descriptor.artifact_id, module_id: 'screen_ink', offset: 0, length: 65536 } }]);
});

test('oversized, wrong owner and malformed artifact metadata cannot allocate or return image data', async () => {
  for (const changes of [{ artifact_id: '../escape' }, { byte_length: 17 * 1024 * 1024 }, { width: 16_000_001 }, { module_id: 'password_vault' }]) {
    const f = fixture();
    await assert.rejects(readAgentArtifact(f.desktop, { ...descriptor, ...changes }), { code: 'DESKTOP_PROTOCOL' });
    assert.equal(f.calls.length, 0);
  }
  for (const changes of [{ revision: 8 }, { width: 2 }, { data_base64: '!' }, { eof: false }, { offset: 1 }, { module_id: 'screenshot' }]) {
    const f = fixture(value => ({ ...value, ...changes }));
    await assert.rejects(readAgentArtifact(f.desktop, descriptor), { code: 'DESKTOP_PROTOCOL' });
  }
});

test('revocation after the last chunk and cancellation stop publication', async () => {
  const f = fixture((value, revoke) => { revoke(); return value; });
  await assert.rejects(readAgentArtifact(f.desktop, descriptor), { code: 'AGENT_ACCESS_DENIED' });
  const controller = new AbortController(); controller.abort();
  const cancelled = fixture();
  await assert.rejects(readAgentArtifact(cancelled.desktop, descriptor, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cancelled.calls.length, 0);
});
