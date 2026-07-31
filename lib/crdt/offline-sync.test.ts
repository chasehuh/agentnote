import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { noteDocStorageKey } from "./local-persistence";
import {
  NOTE_TEXT_KEY,
  docFromUpdates,
  encodeMissingUpdate,
  seedDocFromPlaintext,
} from "./note-doc";

/**
 * Offline reconciliation: the load handshake has to push what the server has
 * never seen, not only pull what the client is missing. Without it, edits made
 * while offline would sit in IndexedDB forever.
 */

describe("noteDocStorageKey", () => {
  it("scopes local storage per user and note", () => {
    expect(noteDocStorageKey("user_1", "abc-defg-hij")).toBe(
      "agentnote.note.user_1.abc-defg-hij",
    );
    expect(noteDocStorageKey("user_1", "abc-defg-hij")).not.toBe(
      noteDocStorageKey("user_2", "abc-defg-hij"),
    );
  });
});

describe("encodeMissingUpdate as the client-side push", () => {
  it("returns nothing when the device is merely behind the server", () => {
    const seed = seedDocFromPlaintext("shared");
    const device = docFromUpdates([seed]);

    const server = docFromUpdates([seed]);
    server.getText(NOTE_TEXT_KEY).insert(0, "server ");
    const serverVector = Y.encodeStateVector(server);

    // The server is ahead; the device has nothing it needs. Pushing an
    // effectively empty update here would cost a log row for no reason.
    expect(encodeMissingUpdate(device, serverVector)).toBeNull();
  });

  it("returns the offline work the server has never seen", () => {
    const seed = seedDocFromPlaintext("shared");
    const server = docFromUpdates([seed]);
    const serverVector = Y.encodeStateVectorFromUpdate(
      Y.encodeStateAsUpdate(server),
    );

    // Restored from IndexedDB after editing with no connection.
    const device = docFromUpdates([seed]);
    device.getText(NOTE_TEXT_KEY).insert(0, "written offline ");

    const unsent = encodeMissingUpdate(device, serverVector);
    expect(unsent).not.toBeNull();

    Y.applyUpdate(server, unsent as Uint8Array);
    expect(server.getText(NOTE_TEXT_KEY).toString()).toBe(
      "written offline shared",
    );
  });

  it("pushes offline work and pulls concurrent server work in the same round", () => {
    const seed = seedDocFromPlaintext("note\n");
    const server = docFromUpdates([seed]);
    const device = docFromUpdates([seed]);

    // Both sides moved while the device was disconnected.
    server.getText(NOTE_TEXT_KEY).insert(0, "from another device\n");
    device.getText(NOTE_TEXT_KEY).insert(
      device.getText(NOTE_TEXT_KEY).length,
      "typed offline\n",
    );

    const serverState = Y.encodeStateAsUpdate(server);
    const serverVector = Y.encodeStateVectorFromUpdate(serverState);

    // What `load()` does: apply the server state, then push what it lacks.
    Y.applyUpdate(device, serverState, "remote");
    const unsent = encodeMissingUpdate(device, serverVector);
    expect(unsent).not.toBeNull();
    Y.applyUpdate(server, unsent as Uint8Array);

    const merged = device.getText(NOTE_TEXT_KEY).toString();
    expect(server.getText(NOTE_TEXT_KEY).toString()).toBe(merged);
    expect(merged).toContain("from another device");
    expect(merged).toContain("typed offline");
    expect(merged).toContain("note");
  });

  it("is a no-op once the push has landed", () => {
    const seed = seedDocFromPlaintext("x");
    const device = docFromUpdates([seed]);
    device.getText(NOTE_TEXT_KEY).insert(1, "y");

    const server = docFromUpdates([seed]);
    Y.applyUpdate(server, encodeMissingUpdate(device, Y.encodeStateVector(server))!);

    expect(encodeMissingUpdate(device, Y.encodeStateVector(server))).toBeNull();
  });

  it("survives many offline edits from the same device", () => {
    const seed = seedDocFromPlaintext("start\n");
    const server = docFromUpdates([seed]);
    const serverVector = Y.encodeStateVector(server);

    const device = docFromUpdates([seed]);
    for (let i = 0; i < 100; i += 1) {
      const text = device.getText(NOTE_TEXT_KEY);
      text.insert(text.length, `offline ${i}\n`);
    }

    Y.applyUpdate(server, encodeMissingUpdate(device, serverVector)!);
    expect(server.getText(NOTE_TEXT_KEY).toString()).toBe(
      device.getText(NOTE_TEXT_KEY).toString(),
    );
    expect(server.getText(NOTE_TEXT_KEY).toString()).toContain("offline 99");
  });
});
