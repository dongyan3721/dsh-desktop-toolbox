import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import * as Executor from '@deepseek-ai/dsh-tool-executor-native';
import LocalAttachments from '@deepseek-ai/dsh-attachment-local';
import { createAgentToolRegistry } from '../packages/dsh-toolbox/src/agent/registry.js';
import { createAgentImagePublisher } from '../packages/dsh-toolbox/src/agent/image.js';
import { readAgentArtifact } from '../packages/dsh-toolbox/src/desktop/artifacts.js';

test('generated PNG traverses bounded chunks, real attachment storage and actual SDK tool rendering', { timeout: 15000 }, async () => {
  const ctx = new Context();
  const home = fileURLToPath(new URL(`../runtime/attachment-sdk/${randomUUID()}/`, import.meta.url));
  const width = 512; const height = 128;
  const bytes = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(bytes.length > 65536);
  const artifact = { artifact_id: 'b'.repeat(32), mime_type: 'image/png', byte_length: bytes.length, width, height };
  const calls = [];
  const snapshot = { revision: 5, modules: [{ id: 'screenshot', agent_supported: true, agent_allowed: true, agent_effective: true }], methods: ['agent.screenshot.capture'] };
  const desktop = {
    async getAgentAccess() { return structuredClone(snapshot); },
    onAgentAccessChanged() { return () => {}; },
    async agentCall(method, params) {
      calls.push({ method, params });
      if (method === 'agent.screenshot.capture') return artifact;
      assert.equal(method, 'agent.artifacts.read');
      const data = bytes.subarray(params.offset, params.offset + params.length);
      return { artifact_id: artifact.artifact_id, module_id: 'screenshot', offset: params.offset,
        total_bytes: bytes.length, mime_type: 'image/png', width, height, revision: 5,
        data_base64: data.toString('base64'), eof: params.offset + data.length === bytes.length };
    },
  };
  let registry;
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(Tools);
    await ctx.plugin(Executor);
    await ctx.plugin(LocalAttachments, { dshHome: home });
    const attachments = ctx.get('attachments');
    assert.ok(attachments);
    registry = createAgentToolRegistry({ tools: ctx.tools, desktop, imagePublisher: createAgentImagePublisher({
      attachments, artifactReader: { read: (value, options) => readAgentArtifact(desktop, value, options) },
    }) });
    await registry.start();
    const batch = await ctx.tools.execute({ calls: [{ id: randomUUID(), name: 'toolbox_screenshot', arguments: JSON.stringify({ action: 'capture', monitor_id: 1 }) }], signal: new AbortController().signal });
    const result = batch.results[0].result;
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok(result.value.image.attachmentId);
    const persisted = await attachments.readImage(result.value.image);
    assert.ok(persisted);
    const stored = persisted.data ?? persisted;
    assert.equal((await sharp(stored).metadata()).width, width);
    assert.ok(calls.filter(call => call.method === 'agent.artifacts.read').length >= 3);
    const definition = ctx.tools.definitions().find(tool => tool.name === 'toolbox_screenshot');
    const content = await definition.output.render({ action: 'capture' }, result.value);
    assert.equal(content.some(block => block.type === 'image' && block.attachment.attachmentId === result.value.image.attachmentId), true);
    assert.ok(attachments.root.toLowerCase().startsWith(home.toLowerCase()));
  } finally { registry?.dispose(); await ctx.fiber.dispose(); }
});
