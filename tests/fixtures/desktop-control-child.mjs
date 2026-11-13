// Test-only protocol child. It does not create a desktop, window, tray or key binding.
import net from 'node:net';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeFrame, FrameDecoder } from '../../packages/dsh-toolbox/src/bridge/framing.js';

const args = process.argv.slice(2);
if (!args.includes('--toolbox-plugin')) process.exit(2);
const value = flag => args[args.indexOf(flag) + 1];
const pipe = value('--pipe-name');
const instanceId = value('--instance-id');
const dataDir = value('--data-dir');
const capabilities = ['status', 'desktop.show_main', 'desktop.open_panel', 'desktop.shutdown', 'desktop.console'];
const server = net.createServer(socket => {
  const decoder = new FrameDecoder();
  socket.on('error', () => {});
  socket.on('close', () => { server.close(); });
  socket.on('data', async bytes => {
    for (const frame of decoder.push(bytes)) {
      if (frame.type === 'hello') {
        socket.write(encodeFrame({ v: 1, type: 'ready', instanceId, capabilities }));
      } else if (frame.type === 'request') {
        await appendFile(join(dataDir, 'fixture-calls.jsonl'), `${JSON.stringify({ method: frame.method, params: frame.params })}\n`);
        const response = { v: 1, type: 'response', id: frame.id, ok: true, result: { opened: true } };
        if (frame.method === 'status') response.result = { protocolVersion: 1, desktop: true, nativeVersion: 'protocol-fixture', capabilities, modules: [] };
        if (frame.method === 'desktop.console') response.result = { fixtureAccepted: frame.params };
        if (frame.method === 'desktop.shutdown') {
          if (args.includes('--shutdown-fails')) {
            response.ok = false;
            delete response.result;
            response.error = { code: 'SAVE_FAILED', message: 'Fixture refuses graceful shutdown' };
          } else {
            response.result = { stopping: true };
            socket.end(encodeFrame(response));
            continue;
          }
        }
        socket.write(encodeFrame(response));
      }
    }
  });
});
server.listen(pipe);
