// Read an iMuninn MCAP recording (one topic per stream, protobuf messages) in the browser.
import { McapIndexedReader } from "@mcap/core";
import { decompress as zstd } from "fzstd";
import { decodeBySchema, type Body } from "./proto";

class FileReadable {
  constructor(private file: File) {}
  async size(): Promise<bigint> { return BigInt(this.file.size); }
  async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    const buf = await this.file.slice(Number(offset), Number(offset + size)).arrayBuffer();
    return new Uint8Array(buf);
  }
}

export interface Timed { logTimeNs: bigint; body: Body }

export class McapSource {
  private reader!: McapIndexedReader;
  startNs = 0n;
  endNs = 0n;
  topics: string[] = [];
  counts: Record<string, number> = {};
  private schemaByChannel = new Map<number, string>();

  static async open(file: File): Promise<McapSource> {
    const s = new McapSource();
    s.reader = await McapIndexedReader.Initialize({
      readable: new FileReadable(file),
      decompressHandlers: {
        zstd: (buf, size) => { const o = zstd(buf); return o.length === Number(size) ? o : o.subarray(0, Number(size)); },
        lz4: () => { throw new Error("lz4 chunks are not supported in the browser reader"); },
      },
      messageIndexCacheSizeBytes: 16 * 1024 * 1024,
    });
    const st = s.reader.statistics;
    for (const [id, ch] of s.reader.channelsById) {
      const schema = s.reader.schemasById.get(ch.schemaId);
      if (schema) s.schemaByChannel.set(id, schema.name);
      if (!["/device", "/capabilities"].includes(ch.topic)) {
        s.topics.push(ch.topic);
        s.counts[ch.topic] = Number(st?.channelMessageCounts.get(id) ?? 0n);
      }
    }
    // Time range of the data topics only (/device and /capabilities are stamped with the
    // PC wall clock, which would stretch the range to decades).
    for await (const m of s.reader.readMessages({ topics: s.topics })) { s.startNs = m.logTime; break; }
    for await (const m of s.reader.readMessages({ topics: s.topics, reverse: true })) { s.endNs = m.logTime; break; }
    return s;
  }

  get durationS(): number { return Number(this.endNs - this.startNs) / 1e9; }

  async *messages(startingAt: bigint, topics: string[]): AsyncGenerator<Timed> {
    for await (const m of this.reader.readMessages({ startingAt, topics })) {
      const name = this.schemaByChannel.get(m.channelId);
      if (!name) continue;
      const body = decodeBySchema(name, m.data);
      if (body) yield { logTimeNs: m.logTime, body };
    }
  }
}
