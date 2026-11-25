import { createServer, Socket } from "node:net";
import { Database } from "../db/engine";
import { FilePager } from "../db/file-pager";
import { decodeFrame, encodeFrame, ProtocolLoop, MAX_FRAME } from "../db/protocol";
import { utf8 } from "../db/codec";

/**
 * SEAMDB wire server.
 *
 * Transport: length-prefixed frames — 4 bytes big-endian frame length, then
 * the frame body (1 type byte + payload) exactly as db/protocol.ts defines
 * them. This file is transport only; every semantic lives in db/protocol.ts.
 *
 * Usage:  npx tsx src/server/tcp.ts [--port N] [--dir DATA_DIR] [--mem]
 *         [--mode development|production]
 */

export interface Args { port: number; dir: string | null; mode: "development" | "production" }

export function parseArgs(argv: string[]): Args {
  const a: Args = { port: 7301, dir: "seamdata", mode: "development" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") a.port = Number(argv[++i]);
    else if (argv[i] === "--dir") a.dir = argv[++i];
    else if (argv[i] === "--mem") a.dir = null;
    else if (argv[i] === "--mode") a.mode = argv[++i] === "production" ? "production" : "development";
  }
  return a;
}

/** Feed arbitrary byte chunks; complete frames are handed to `onFrame` in order. */
export function makeFrameReader(onFrame: (raw: Uint8Array) => void): { push(chunk: Buffer): void } {
  let buf = Buffer.alloc(0);
  return {
    push(chunk: Buffer): void {
      buf = buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (len < 1 || len > MAX_FRAME) {
          onFrame(encodeFrame(5, utf8(JSON.stringify({ code: "E_LIMIT", message: `Frame length ${len} out of range.` }))));
          throw new Error("frame length out of range");
        }
        if (buf.length < 4 + len) return;
        try {
          // Hand over the complete length-prefixed frame for decodeFrame().
          onFrame(buf.subarray(0, 4 + len));
        } catch (e) {
          onFrame(encodeFrame(5, utf8(JSON.stringify({ code: "E_CORRUPT", message: (e as Error).message }))));
          throw e;
        }
        buf = buf.subarray(4 + len);
      }
    },
  };
}

export async function startServer(args: Args): Promise<{ close(): Promise<void>; port: number }> {
  const db = await Database.open(args.dir ? new FilePager(args.dir) : undefined, { mode: args.mode });
  const server = createServer((sock: Socket) => {
    const sess = db.connect({ user: "anon", roles: [] });
    let loop: ProtocolLoop | null = null;
    const reader = makeFrameReader((raw) => {
      void (async () => {
        try {
          const { type } = decodeFrame(raw);
          if (!loop && type !== 1) {
            sock.write(Buffer.from(encodeFrame(5, utf8(JSON.stringify({ code: "E_DENIED", message: "Say hello (frame 1) first." })))));
            return;
          }
          if (!loop) loop = new ProtocolLoop(sess, args.mode);
          sock.write(Buffer.from(await loop.handle(raw)));
        } catch (e) {
          sock.write(Buffer.from(encodeFrame(5, utf8(JSON.stringify({ code: "E_CORRUPT", message: (e as Error).message })))));
          sock.end();
        }
      })();
    });
    sock.on("data", (chunk) => reader.push(chunk));
    sock.on("error", () => undefined);
    sock.on("close", () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return {
    port,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("src/server/tcp.ts");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  startServer(args)
    .then((s) => {
      process.on("SIGINT", () => {
        void s.close().then(() => process.exit(0));
      });
      console.log(`seamdb listening on 127.0.0.1:${s.port} (mode=${args.mode})`);
    })
    .catch((e) => {
      console.error("server failed:", e);
      process.exit(1);
    });
}
