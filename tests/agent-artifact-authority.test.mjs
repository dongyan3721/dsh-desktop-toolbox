import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentImagePublisher } from '../packages/dsh-toolbox/src/agent/image.js';

const artifact = { artifact_id: 'a'.repeat(32), mime_type: 'image/png', byte_length: 8, width: 1, height: 1 };
const image = { attachmentId: 'generated-fixture', mediaType: 'image/png', bytes: 8, width: 1, height: 1 };

test('publisher carries trusted module and grant revision to the artifact reader', async () => {
  let received;
  const publisher = createAgentImagePublisher({
    artifactReader: { async read(descriptor, options) { received = { descriptor, options }; return new Uint8Array(8); } },
    attachments: { async saveImage() { return image; } },
  });
  await publisher.publish({ moduleId: 'screen_ink', descriptor: { ...artifact, revision: 2 }, signal: new AbortController().signal,
    async ensureAuthorized() { return { snapshot: { revision: 9 } }; } });
  assert.equal(received.options.moduleId, 'screen_ink');
  assert.equal(received.options.revision, 2);
  assert.equal(received.descriptor.artifact_id, artifact.artifact_id);
});

test('revoke then regrant between image download and attachment save cannot publish old data', async () => {
  let revision = 9; let saves = 0;
  const publisher = createAgentImagePublisher({
    artifactReader: { async read() { revision = 11; return new Uint8Array(8); } },
    attachments: { async saveImage() { saves++; return image; } },
  });
  await assert.rejects(publisher.publish({ moduleId: 'screenshot', descriptor: { ...artifact, revision: 9 },
    async ensureAuthorized() { return { snapshot: { revision } }; } }), { code: 'AGENT_ACCESS_DENIED' });
  assert.equal(saves, 0);
});
