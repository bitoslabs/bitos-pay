import { decode } from "nostr-tools/nip19";
import { finalizeEvent } from "nostr-tools/pure";

self.onmessage = (message) => {
  try {
    const { nsec, challenge, origin } = message.data || {};
    const decoded = decode(nsec);
    if (decoded.type !== "nsec") throw new Error("Enter an nsec key.");
    const event = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", origin],
          ["challenge", challenge]
        ],
        content: ""
      },
      decoded.data
    );
    self.postMessage({ ok: true, event });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Could not sign the challenge."
    });
  }
};
