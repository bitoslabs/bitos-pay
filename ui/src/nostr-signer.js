import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from "nostr-tools/nip46";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nsecEncode, npubEncode } from "nostr-tools/nip19";

window.PayNostrTools = {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  generateSecretKey,
  getPublicKey,
  nsecEncode,
  npubEncode
};
