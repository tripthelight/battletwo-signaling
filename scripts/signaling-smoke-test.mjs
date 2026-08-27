import WebSocket from 'ws';

const URL = 'ws://127.0.0.1:5000';
const TIMEOUT_MS = 5000;

const results = {
  a: [],
  b: [],
};

function makeClient(name) {
  const ws = new WebSocket(URL);

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        type: 'join',
      }),
    );
  });

  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString());

    results[name].push(msg);

    console.log(
      name,
      msg.type,
      msg.roomId ?? '',
      msg.you?.role ?? msg.role ?? '',
    );
  });

  ws.on('error', (error) => {
    console.error(`${name} ERROR:`, error.message);
  });

  return ws;
}

const a = makeClient('a');
const b = makeClient('b');

const startedAt = Date.now();

const timer = setInterval(() => {
  const pairedA = results.a.find((value) => value.type === 'paired');
  const pairedB = results.b.find((value) => value.type === 'paired');

  if (pairedA && pairedB) {
    clearInterval(timer);

    const sameRoom =
      Boolean(pairedA.roomId) &&
      pairedA.roomId === pairedB.roomId;

    console.log('SAME_ROOM:', sameRoom);
    console.log('ROOM_ID:', pairedA.roomId);
    console.log('A_ROLE:', pairedA.you.role);
    console.log('B_ROLE:', pairedB.you.role);

    a.close();
    b.close();

    setTimeout(() => {
      process.exit(sameRoom ? 0 : 1);
    }, 100);

    return;
  }

  if (Date.now() - startedAt > TIMEOUT_MS) {
    clearInterval(timer);

    console.error('TIMEOUT');

    a.close();
    b.close();

    setTimeout(() => {
      process.exit(2);
    }, 100);
  }
}, 100);