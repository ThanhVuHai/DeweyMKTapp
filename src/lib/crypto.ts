import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'f3d61b369c0d11ee85f90242ac130002'; // fallback for safety
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypt a plain text string using AES-256-CBC
 */
export function encrypt(text: string): string {
  // Ensure we have exactly 32 bytes for the key
  const key = Buffer.alloc(32);
  Buffer.from(ENCRYPTION_KEY, 'utf-8').copy(key);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt an encrypted hex string back to plain text
 */
export function decrypt(text: string): string {
  try {
    const textParts = text.split(':');
    if (textParts.length !== 2) {
      throw new Error('Invalid encrypted text format');
    }
    
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    
    const key = Buffer.alloc(32);
    Buffer.from(ENCRYPTION_KEY, 'utf-8').copy(key);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption failed:', error);
    return ''; // Return empty or throw based on preference
  }
}

/**
 * Mask access token for security display (e.g. EAAB************xyz)
 * Never exposes the full token string to the client.
 */
export function maskToken(token: string): string {
  if (!token) return '';
  let plain = token;
  if (token.includes(':')) {
    plain = decrypt(token);
  }
  if (!plain || plain.length <= 8) return '********';
  const prefix = plain.substring(0, 4);
  const suffix = plain.substring(plain.length - 3);
  return `${prefix}************${suffix}`;
}
