export interface SecretBox {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}
