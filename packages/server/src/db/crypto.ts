import crypto from 'node:crypto'
import { config } from '../config.js'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  // 32바이트 키 생성 (SHA-256 해시로 정규화)
  return crypto.createHash('sha256').update(config.encryptionKey).digest()
}

/**
 * AES-256-GCM으로 텍스트를 암호화한다.
 * 반환값: base64(iv):base64(authTag):base64(ciphertext)
 */
export function encrypt(text: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

/**
 * AES-256-GCM으로 암호화된 텍스트를 복호화한다.
 */
export function decrypt(encryptedText: string): string {
  const key = getKey()
  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format')
  }

  const [ivB64, authTagB64, ciphertext] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
