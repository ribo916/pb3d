import { createServer } from 'vite';

export async function startViteServer(root) {
  var port = Number(process.env.PORT || (43000 + Math.floor(Math.random() * 10000)));
  var server = await createServer({
    root: root,
    clearScreen: false,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: port,
      strictPort: false,
      hmr: false
    }
  });
  await server.listen();
  var addr = server.httpServer.address();
  port = typeof addr === 'object' && addr ? addr.port : port;
  return {
    server: server,
    base: 'http://127.0.0.1:' + port + '/'
  };
}
