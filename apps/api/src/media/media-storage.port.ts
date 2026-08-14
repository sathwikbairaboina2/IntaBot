export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

export interface MediaStoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  presignedUrl(key: string, ttlSeconds: number): Promise<string>;
}
