import { Readable } from 'node:stream';
import type { ArtifactStorage, SavedArtifact } from './local.js';

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk)));
  }
  let totalLength = 0;
  for (const c of chunks) totalLength += c.byteLength;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.byteLength;
  }
  return result.buffer as ArrayBuffer;
}

export class SupabaseArtifactStorage implements ArtifactStorage {
  private readonly bucket = 'artifacts';

  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  async saveArtifact(options: {
    submissionId: string;
    artifactId: string;
    filename: string;
    stream: NodeJS.ReadableStream;
  }): Promise<SavedArtifact> {
    const safeFilename = sanitizeFilename(options.filename || 'upload.bin');
    const storageKey = `${options.submissionId}/${options.artifactId}-${safeFilename}`;
    const buffer = await streamToBuffer(options.stream);

    const url = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${storageKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: new Blob([buffer]),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase storage upload failed (${response.status}): ${body}`);
    }

    return {
      storageKey,
      absolutePath: url,
      sizeBytes: buffer.byteLength,
    };
  }

  createReadStream(storageKey: string): NodeJS.ReadableStream {
    const url = `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${storageKey}`;
    const serviceRoleKey = this.serviceRoleKey;

    // Return a lazy readable stream that fetches on first read
    let started = false;
    let sourceStream: ReadableStream<Uint8Array> | null = null;

    const readable = new Readable({
      async read() {
        if (!started) {
          started = true;
          try {
            const response = await fetch(url, {
              headers: { 'Authorization': `Bearer ${serviceRoleKey}` },
            });
            if (!response.ok || !response.body) {
              this.destroy(new Error(`Supabase storage download failed (${response.status})`));
              return;
            }
            sourceStream = response.body;
            const reader = sourceStream.getReader();
            const pump = async () => {
              try {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    this.push(null);
                    return;
                  }
                  if (!this.push(value)) {
                    // Backpressure: wait for the next read call
                    return;
                  }
                }
              } catch (err) {
                this.destroy(err instanceof Error ? err : new Error(String(err)));
              }
            };
            void pump();
          } catch (err) {
            this.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        }
      },
    });

    return readable;
  }

  sanitizeForContentDisposition(filename: string): string {
    const safe = sanitizeFilename(filename);
    return `attachment; filename="${safe}"`;
  }
}
