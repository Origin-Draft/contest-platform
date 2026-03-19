import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, access, constants } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export interface ArtifactStorage {
  saveArtifact(options: {
    submissionId: string;
    artifactId: string;
    filename: string;
    stream: NodeJS.ReadableStream;
  }): Promise<SavedArtifact>;
  createReadStream(storageKey: string): NodeJS.ReadableStream;
  sanitizeForContentDisposition(filename: string): string;
}

export interface SavedArtifact {
  storageKey: string;
  absolutePath: string;
  sizeBytes: number;
}

export class LocalArtifactStorage implements ArtifactStorage {
  constructor(private readonly rootDir: string) {}

  async saveArtifact(options: {
    submissionId: string;
    artifactId: string;
    filename: string;
    stream: NodeJS.ReadableStream;
  }): Promise<SavedArtifact> {
    const safeFilename = sanitizeFilename(options.filename || 'upload.bin');
    const submissionDir = path.join(this.rootDir, options.submissionId);
    if (!path.resolve(submissionDir).startsWith(path.resolve(this.rootDir))) {
      throw new Error('Invalid submission ID');
    }
    await mkdir(submissionDir, { recursive: true });

    const storageKey = path.join(options.submissionId, `${options.artifactId}-${safeFilename}`);
    const absolutePath = path.join(this.rootDir, storageKey);

    await pipeline(options.stream, createWriteStream(absolutePath));
    const fileStat = await stat(absolutePath);

    return {
      storageKey,
      absolutePath,
      sizeBytes: fileStat.size,
    };
  }

  createReadStream(storageKey: string): NodeJS.ReadableStream {
    const safePath = path.resolve(this.rootDir, storageKey);
    if (!safePath.startsWith(path.resolve(this.rootDir))) {
      throw new Error('Invalid storage key');
    }
    return createReadStream(safePath);
  }

  sanitizeForContentDisposition(filename: string): string {
    const safe = sanitizeFilename(filename);
    return `attachment; filename="${safe}"`;
  }
}
