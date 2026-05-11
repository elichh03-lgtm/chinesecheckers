import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import { env, s3Configured } from '../env.js';

const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const;
type AllowedExt = (typeof ALLOWED_EXTS)[number];

const CONTENT_TYPES: Record<AllowedExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

function isAllowedExt(ext: string): ext is AllowedExt {
  return (ALLOWED_EXTS as readonly string[]).includes(ext);
}

export type AvatarPresign = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  contentType: string;
};

export async function getAvatarPresignedPutUrl(
  userId: string,
  ext: string,
): Promise<AvatarPresign> {
  if (!s3Configured) throw new Error('S3 not configured');
  const normalized = ext.toLowerCase().replace(/^\./, '');
  if (!isAllowedExt(normalized)) {
    throw new Error(`Unsupported extension: ${ext}`);
  }
  const bucket = env.AWS_S3_BUCKET!;
  const key = `avatars/${userId}/${nanoid()}.${normalized}`;
  const contentType = CONTENT_TYPES[normalized];
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );
  const publicUrl = `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  return { uploadUrl, publicUrl, key, contentType };
}
